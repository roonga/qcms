/**
 * The provenance check (SEC-17, section 7.4), over the user, the ordered step list, the
 * step's arguments and its environment. It adds provenance and never rights, and a token
 * that fails never degrades to an ordinary human act.
 */

import { actionKind, actionKindForRoute } from "./actions/registry.js";
import type { ActionKindDef, ActionRequestFacts } from "./actions/types.js";
import {
  argumentsDigest,
  canonicalJson,
  PROPOSAL_TTL_MS,
  verifyProposalToken,
  type ProposalRefusalCode,
  type ProposalTokenPayload,
} from "./proposal-token.js";

export const PROPOSAL_HEADER = "x-qcms-agent-proposal";
export const PROPOSAL_STEP_HEADER = "x-qcms-agent-step";

/** One step this proposal has already recorded, as `control.agent_actions` holds it. */
export interface RecordedStep {
  readonly stepIndex: number;
  readonly detail: string | null;
  readonly confirmedAt: Date;
}

export interface ProvenanceInput {
  readonly token: string;
  readonly rawStep: string;
  readonly appKey: string;
  /** The authenticated principal, which the token's `sub` must equal. */
  readonly subject: string;
  readonly facts: ActionRequestFacts;
  readonly recorded: readonly RecordedStep[];
  readonly now: Date;
}

/** What a verified step hands the handler, which is what its audit row is written from. */
export interface VerifiedProposal {
  readonly proposalId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly kind: string;
  readonly screen: string;
  readonly environment: string;
  readonly proposedAt: Date;
  readonly formId: string | undefined;
  /** The result fields this kind may record as its non-content detail. */
  readonly references: readonly string[];
}

export type ProvenanceResult =
  | { readonly ok: true; readonly proposal: VerifiedProposal }
  | { readonly ok: false; readonly code: ProposalRefusalCode };

function refused(code: ProposalRefusalCode): ProvenanceResult {
  return { ok: false, code };
}

function stepIndexOf(raw: string): number | undefined {
  if (!/^\d{1,3}$/.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
}

/**
 * The request carries a value where the token's digest carries `{ fromStep, field }`. The
 * symbolic form is rebuilt from the audit rows alone, never from anything the browser
 * says, so a reference resolves only to what its step recorded.
 */
function symbolicCandidates(
  args: Readonly<Record<string, unknown>>,
  input: ProvenanceInput,
  token: ProposalTokenPayload,
): readonly Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [{ ...args }];
  for (const [member, value] of Object.entries(args)) {
    for (const reference of referencesFor(value, input, token)) {
      if (candidates.length >= CANDIDATE_LIMIT) return candidates;
      candidates.push({ ...args, [member]: reference });
    }
  }
  return candidates;
}

/** One substitution at a time, which is the shape the design describes and bounds the work. */
const CANDIDATE_LIMIT = 128;

/**
 * A row resolves only the one field its kind records, so a reference that names any other
 * field of that step matches no candidate and is refused.
 */
function referencesFor(
  value: unknown,
  input: ProvenanceInput,
  token: ProposalTokenPayload,
): readonly { readonly fromStep: number; readonly field: string }[] {
  if (typeof value !== "string" && typeof value !== "number") return [];
  const asText = String(value);
  const found: { fromStep: number; field: string }[] = [];
  for (const row of input.recorded) {
    if (row.detail !== asText) continue;
    const earlier = token.steps[row.stepIndex];
    const field = (earlier === undefined ? undefined : actionKind(earlier.kind))?.references[0];
    if (field === undefined) continue;
    found.push({ fromStep: row.stepIndex, field });
  }
  return found;
}

async function argumentsMatch(
  def: ActionKindDef,
  input: ProvenanceInput,
  token: ProposalTokenPayload,
  expectedDigest: string,
): Promise<boolean> {
  const recomputed = def.recomputeArgs(input.facts);
  if (typeof recomputed !== "object" || recomputed === null) return false;
  for (const candidate of symbolicCandidates(recomputed as Record<string, unknown>, input, token)) {
    try {
      if ((await argumentsDigest(candidate)) === expectedDigest) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * The window a step after step 0 arrives in: ten minutes from step 0's recorded
 * confirmation, so a plan whose run crosses `exp` completes while a stale card cannot
 * start.
 */
function withinRunWindow(input: ProvenanceInput): boolean {
  const first = input.recorded.find((row) => row.stepIndex === 0);
  if (first === undefined) return false;
  return input.now.getTime() - first.confirmedAt.getTime() <= PROPOSAL_TTL_MS;
}

export async function checkProvenance(input: ProvenanceInput): Promise<ProvenanceResult> {
  const stepIndex = stepIndexOf(input.rawStep);
  if (stepIndex === undefined) return refused("AGENT_PROPOSAL_MALFORMED");

  const verified = await verifyProposalToken(input.appKey, input.token);
  if (!verified.ok) return refused(verified.code);
  const token = verified.payload;

  if (token.sub !== input.subject) return refused("AGENT_PROPOSAL_SUBJECT");

  const step = token.steps[stepIndex];
  if (step === undefined) return refused("AGENT_PROPOSAL_STEP_RANGE");

  if (stepIndex === 0 && input.now.getTime() > token.exp) {
    return refused("AGENT_PROPOSAL_EXPIRED");
  }

  // Steps `0` to `i-1` all recorded, so a step runs only in order and only after its
  // predecessors succeeded. A failed step wrote no row, which is what stops the next one.
  const recordedIndexes = new Set(input.recorded.map((row) => row.stepIndex));
  for (let earlier = 0; earlier < stepIndex; earlier += 1) {
    if (!recordedIndexes.has(earlier)) return refused("AGENT_PROPOSAL_ORDER");
  }
  if (recordedIndexes.has(stepIndex)) return refused("AGENT_PROPOSAL_ORDER");

  // After the order check, so an unrecorded predecessor reads as out of order rather than
  // as a window that never opened.
  if (stepIndex > 0 && !withinRunWindow(input)) return refused("AGENT_PROPOSAL_WINDOW");

  const routed = actionKindForRoute(input.facts.method, input.facts.path);
  if (routed === undefined || routed.kind !== step.kind) return refused("AGENT_PROPOSAL_ROUTE");

  if (input.facts.environment !== step.environment) {
    return refused("AGENT_PROPOSAL_ENVIRONMENT");
  }

  if (!(await argumentsMatch(routed, input, token, step.argsDigest))) {
    // One code for both, because telling a caller which half failed tells it how to
    // search for the other.
    return refused("AGENT_PROPOSAL_ARGUMENTS");
  }

  return {
    ok: true,
    proposal: {
      proposalId: token.pid,
      stepIndex,
      stepCount: token.steps.length,
      kind: step.kind,
      screen: routed.screen,
      environment: step.environment,
      proposedAt: new Date(token.iat),
      formId: token.formId,
      references: routed.references,
    },
  };
}

/** The refusal message for one code. Stable text, and it never names what to try next. */
export function provenanceMessage(code: ProposalRefusalCode): string {
  switch (code) {
    case "AGENT_PROPOSAL_DISABLED":
      return "This deployment does not run the assistant, so it records no agent provenance.";
    case "AGENT_PROPOSAL_EXPIRED":
      return "That proposal is more than ten minutes old. Ask the assistant again.";
    case "AGENT_PROPOSAL_WINDOW":
      return "That plan's run has taken too long. Ask the assistant again.";
    default:
      return "That proposal does not authorise this request.";
  }
}

/** Exported so the digest a card would produce can be asserted against this module's own. */
export const canonicalArguments = canonicalJson;
