import { z } from "zod";

import { getForm, getQuestion, type FormRow } from "@roonga/qcms-db";
import {
  parseFormId,
  parseQuestionId,
  parseSessionId,
  type FormId,
  type QuestionId,
  type SessionId,
} from "@roonga/qcms-core";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import {
  decideAccess,
  isEnvironmentScoped,
  isFormScoped,
  type AccessRequest,
  type Resource,
} from "../../membership/policy.js";
import {
  resolveCallerWorkspaces,
  resolveGrants,
  workspacesAllowing,
  type ResolvedMembership,
} from "../../membership/resolver.js";

/**
 * What a context builder is handed, and the grant checks every builder makes before it reads anything. The
 * browser sends a screen id and route ids and never context content, so everything a turn tells the model is
 * computed here under the caller's own grants.
 */

/** Route ids and the response list's filters: the whole of what a turn may send. */
export const ScreenParams = z.strictObject({
  formId: z.string().max(200).optional(),
  questionId: z.string().max(200).optional(),
  workspaceId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  /** The response list's own four filters, which take no answer value. */
  filters: z
    .strictObject({
      version: z.number().int().min(1).max(1_000_000).optional(),
      from: z.string().max(40).optional(),
      to: z.string().max(40).optional(),
      flagged: z.boolean().optional(),
    })
    .optional(),
});

export type ScreenParams = z.infer<typeof ScreenParams>;

export interface ScreenBuildInput {
  readonly deps: Deps;
  readonly principal: { readonly userId: string; readonly claim: boolean };
  /** The environment the switcher header named for this turn. */
  readonly environment: string;
  readonly params: ScreenParams;
  /**
   * Random, minted by the admin when a conversation starts. The key a screen's audited
   * read is deduplicated by, never an identity.
   */
  readonly conversationId: string;
  /**
   * The conversation's current stay on one subject, minted by the admin on arrival. A
   * conversation that leaves a subject and returns owes a new row.
   */
  readonly visitId: string;
}

/** How many rows of a list a screen's facts carry; a turn is a payload, not a page. */
export const FACT_ROW_LIMIT = 50;

export const forbidden = (reason: string): ApiError => new ApiError("FORBIDDEN", 403, reason);

const fail = {
  malformed: (what: string): ApiError =>
    new ApiError("INVALID_ID", 400, `Malformed ${what} id for this screen`),
  missing: (what: string): ApiError =>
    new ApiError("INVALID_REQUEST", 400, `This screen needs a ${what} id`),
  notFound: (what: string): ApiError =>
    new ApiError(`${what.toUpperCase()}_NOT_FOUND`, 404, `No such ${what}`),
};

export interface ScreenForm {
  readonly formId: FormId;
  readonly workspaceId: string;
  readonly row: FormRow;
}

/**
 * The form a tool names, or the one the screen names when it names none. The screen is
 * context: it supplies the default id, and a tool may reach any other subject the caller's
 * own grants cover.
 */
export async function resolveForm(input: ScreenBuildInput, named?: string): Promise<ScreenForm> {
  const raw = named ?? input.params.formId;
  if (raw === undefined) throw fail.missing("form");
  const parsed = parseFormId(raw);
  if (!parsed.ok) throw fail.malformed("form");
  const row = await getForm(input.deps.databases.control, parsed.value);
  if (row === undefined) throw fail.notFound("form");
  return { formId: parsed.value, workspaceId: row.workspaceId, row };
}

export async function requireForm(input: ScreenBuildInput): Promise<ScreenForm> {
  return resolveForm(input);
}

export async function resolveQuestion(
  input: ScreenBuildInput,
  named?: string,
): Promise<{ readonly questionId: QuestionId; readonly workspaceId: string }> {
  const raw = named ?? input.params.questionId;
  if (raw === undefined) throw fail.missing("question");
  const parsed = parseQuestionId(raw);
  if (!parsed.ok) throw fail.malformed("question");
  const row = await getQuestion(input.deps.databases.control, parsed.value);
  if (row === undefined) throw fail.notFound("question");
  return { questionId: parsed.value, workspaceId: row.workspaceId };
}

export async function requireQuestion(
  input: ScreenBuildInput,
): Promise<{ readonly questionId: QuestionId; readonly workspaceId: string }> {
  return resolveQuestion(input);
}

export function resolveWorkspaceId(input: ScreenBuildInput, named?: string): string {
  const raw = named ?? input.params.workspaceId;
  if (raw === undefined || raw === "") throw fail.missing("workspace");
  return raw;
}

export function requireSession(input: ScreenBuildInput): SessionId {
  const raw = input.params.sessionId;
  if (raw === undefined) throw fail.missing("session");
  const parsed = parseSessionId(raw);
  if (!parsed.ok) throw fail.malformed("session");
  return parsed.value;
}

export function requireWorkspaceId(input: ScreenBuildInput): string {
  const raw = input.params.workspaceId;
  if (raw === undefined || raw === "") throw fail.missing("workspace");
  return raw;
}

function requestFor(args: {
  readonly resource: Resource;
  readonly action: string;
  readonly environment: string;
  readonly formId?: string;
}): AccessRequest {
  return {
    resource: args.resource,
    action: args.action,
    ...(isEnvironmentScoped(args.resource, args.action) ? { environment: args.environment } : {}),
    ...(isFormScoped(args.resource, args.action) && args.formId !== undefined
      ? { formId: args.formId }
      : {}),
  };
}

/**
 * The caller's grants in one workspace, through the evaluator the route middleware uses,
 * so a builder cannot read what the screen's own request would be refused.
 */
export async function membershipIn(
  input: ScreenBuildInput,
  workspaceId: string,
): Promise<ResolvedMembership> {
  return resolveGrants(input.deps.databases.control, {
    userId: input.principal.userId,
    workspaceId,
    claim: input.principal.claim,
  });
}

export async function requireCell(
  input: ScreenBuildInput,
  args: {
    readonly workspaceId: string;
    readonly resource: Resource;
    readonly action: string;
    readonly formId?: string;
  },
): Promise<ResolvedMembership> {
  const resolved = await membershipIn(input, args.workspaceId);
  const decision = decideAccess({
    memberRole: resolved.memberRole,
    grants: resolved.grants,
    request: requestFor({ ...args, environment: input.environment }),
  });
  if (!decision.allowed) throw forbidden(decision.reason ?? "Refused");
  return resolved;
}

/**
 * The workspaces the caller holds a cell in, or none.
 *
 * Distinct from {@link workspacesHolding}, which refuses the turn: the grant filter asks
 * the same question to decide what to offer, and a caller who may create nowhere is
 * offered nothing rather than refused.
 */
export async function workspacesHoldingOrNone(
  input: ScreenBuildInput,
  args: { readonly resource: Resource; readonly action: string },
): Promise<readonly string[]> {
  const resolved = await resolveCallerWorkspaces(input.deps.databases.control, {
    userId: input.principal.userId,
    claim: input.principal.claim,
  });
  return workspacesAllowing(resolved, requestFor({ ...args, environment: input.environment }));
}

/**
 * The form ids a membership can answer a form-scoped cell for: whatever its grants name,
 * plus the wildcard a workspace-wide grant carries. A form-scoped cell asked with no form
 * id is refused outright by the policy, so eligibility has to ask about some form.
 */
function candidateForms(membership: ResolvedMembership): readonly string[] {
  const ids = new Set<string>(["all"]);
  for (const grant of membership.grants) for (const id of grant.forms) ids.add(id);
  return [...ids];
}

/** The caller's grants in every workspace they hold one in, resolved once per turn. */
export async function callerWorkspaces(
  input: ScreenBuildInput,
): Promise<readonly ResolvedMembership[]> {
  return resolveCallerWorkspaces(input.deps.databases.control, {
    userId: input.principal.userId,
    claim: input.principal.claim,
  });
}

/**
 * Whether the caller holds a cell on any subject at all, which is what decides whether a
 * read tool is offered this turn. It is deliberately coarse: the tool's own port re-makes
 * the check against the subject the call names, and that check is the control.
 */
export function holdsCellIn(
  resolved: readonly ResolvedMembership[],
  environment: string,
  args: { readonly resource: Resource; readonly action: string },
): boolean {
  if (!isFormScoped(args.resource, args.action)) {
    return workspacesAllowing(resolved, requestFor({ ...args, environment })).length > 0;
  }
  return resolved.some((membership) =>
    candidateForms(membership).some(
      (formId) =>
        decideAccess({
          memberRole: membership.memberRole,
          grants: membership.grants,
          request: requestFor({ ...args, environment, formId }),
        }).allowed,
    ),
  );
}

export async function holdsCellAnywhere(
  input: ScreenBuildInput,
  args: { readonly resource: Resource; readonly action: string },
): Promise<boolean> {
  return holdsCellIn(await callerWorkspaces(input), input.environment, args);
}

/** The workspaces the caller holds a cell in, which is what narrows a list screen's read. */
export async function workspacesHolding(
  input: ScreenBuildInput,
  args: { readonly resource: Resource; readonly action: string },
): Promise<readonly string[]> {
  const allowed = await workspacesHoldingOrNone(input, args);
  if (allowed.length === 0) {
    const request = requestFor({ ...args, environment: input.environment });
    throw forbidden(
      decideAccess({ memberRole: undefined, grants: [], request }).reason ?? "Refused",
    );
  }
  return allowed;
}

const CONVERSATION_WINDOW_MS = 12 * 60 * 60 * 1_000;

/**
 * One in-flight audited read. The claim is held by this token rather than by the promise
 * itself, so taking it back out of the map never compares promise values.
 */
interface OpenClaim {
  readonly done: Promise<unknown>;
}

/** The claims open in this process, keyed as the limiter keys them. */
const openClaims = new Map<string, OpenClaim>();

const ignore = (): undefined => undefined;

/**
 * Audit the first turn of each stay on a subject in an environment. A failed read releases its claim;
 * concurrent turns wait for that claim so none can skip an unwritten row.
 */
export async function auditedRead<T>(
  input: ScreenBuildInput,
  subject: string,
  run: (audit: boolean) => Promise<T>,
): Promise<T> {
  const key = `agent-read:${input.principal.userId}:${input.environment}:${input.conversationId}:${input.visitId}:${subject}`;
  let open = openClaims.get(key);
  while (open !== undefined) {
    await open.done.then(ignore, ignore);
    if (openClaims.get(key) === open) openClaims.delete(key);
    open = openClaims.get(key);
  }
  // Registered before its own first await, so a turn arriving later cannot pass the wait
  // above and then race this one for the claim.
  const attempt = claimed(input, key, run);
  const claim: OpenClaim = { done: attempt };
  openClaims.set(key, claim);
  try {
    return await attempt;
  } finally {
    if (openClaims.get(key) === claim) openClaims.delete(key);
  }
}

async function claimed<T>(
  input: ScreenBuildInput,
  key: string,
  run: (audit: boolean) => Promise<T>,
): Promise<T> {
  const hit = await input.deps.rateLimitStore.hit(key, CONVERSATION_WINDOW_MS);
  if (hit.count !== 1) return run(false);
  try {
    return await run(true);
  } catch (error) {
    await input.deps.rateLimitStore.reset(key);
    throw error;
  }
}

/** An ISO instant, or `null`, which is what a fact line says about an absent time. */
export function iso(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

/** The facts schemas' time field: an instant, never a locale-formatted string. */
export const Instant = z.string().nullable();
