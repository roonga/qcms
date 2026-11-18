/**
 * The agent audit rows: one per confirmed card step, one per card-less builder edit or Undo, and one per
 * docked-assistant accept, each from a verified token and written inside **the act's own transaction**, so a
 * failed act writes no row and the trail and the result agree.
 */

import { FormId, type Appearance } from "@roonga/qcms-core";
import {
  agentStepRecorded,
  getDraftForUpdate,
  getLatestPublishedVersion,
  writeAgentActionRow,
  type Executor,
  type FormDraftRow,
} from "@roonga/qcms-db";
import type { Context } from "hono";

import type { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import {
  ACCEPT_KIND,
  acceptRefusal,
  acceptRowKey,
  verifyAcceptToken,
  type AcceptRefusalCode,
  type AcceptTokenPayload,
} from "./accept-token.js";
import { editRefusal, type VerifiedEdit } from "./edit-provenance.js";
import {
  BUILDER_SCREEN,
  EDIT_TOKEN_PURPOSE,
  EDIT_TOKEN_VERSION,
  EDITS_PER_TURN,
  draftStateDigest,
  rowKind,
  signEditToken,
} from "./edit-token.js";
import { canonicalJson } from "./proposal-token.js";
import type { VerifiedProposal } from "./provenance.js";

export interface AgentStepSite {
  readonly proposal: VerifiedProposal;
  readonly actor: string;
  readonly workspaceId: string;
}

/**
 * The verified proposal and the actor and workspace its row is written under, or
 * `undefined` for an ordinary human request. A verified step whose route resolved no
 * workspace is a build defect rather than a caller's doing, so it throws and the step's
 * own transaction rolls the act back with it.
 */
export function agentStepSite(c: Context<ApiEnv>): AgentStepSite | undefined {
  const proposal = c.get("agentProposal");
  if (proposal === undefined) return undefined;
  const actor = c.get("adminPrincipal")?.userId;
  const workspaceId = c.get("grantContext")?.workspaceId;
  if (actor === undefined || workspaceId === undefined) {
    throw new Error(
      `Action kind "${proposal.kind}" verified a proposal on a route that resolves no ` +
        "workspace, so its step cannot be audited.",
    );
  }
  return { proposal, actor, workspaceId };
}

/**
 * Appends one step row, or nothing for a request with no verified proposal. `detail` is
 * the step's non-content detail: a version number, an environment name, a count or a role
 * name. It is the record a later step's reference is checked against, so it must be the
 * value that step would resolve. Never an answer value, a secret or `LocalizedText`.
 */
export async function writeAgentStep(
  exec: Executor,
  site: AgentStepSite | undefined,
  detail: string | undefined,
  confirmedAt: Date,
): Promise<void> {
  if (site === undefined) return;
  await writeAgentActionRow(exec, {
    proposalId: site.proposal.proposalId,
    stepIndex: site.proposal.stepIndex,
    stepCount: site.proposal.stepCount,
    actor: site.actor,
    workspaceId: site.workspaceId,
    environment: site.proposal.environment,
    formId: site.proposal.formId,
    kind: site.proposal.kind,
    screen: site.proposal.screen,
    proposedAt: site.proposal.proposedAt,
    confirmedAt,
    detail,
  });
}

function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

interface HeldDraft {
  readonly definition: unknown;
  readonly appearance: Appearance | null;
  /** 0 when the form has no draft row and the state is the newest version's. */
  readonly revision: number;
}

interface HeldState {
  readonly draft: HeldDraft | undefined;
  /** The newest published version, 0 for none. */
  readonly base: number;
}

/**
 * The state an edit applies to, which is what the form read serves: the draft row, locked
 * for the rest of the save, else the newest version a first save is seeded from.
 */
async function heldState(exec: Executor, formId: FormId): Promise<HeldState> {
  const draft = await getDraftForUpdate(exec, formId);
  const newest = await getLatestPublishedVersion(exec, formId);
  const base = newest?.version ?? 0;
  if (draft !== undefined) {
    return {
      draft: {
        definition: draft.definition,
        appearance: draft.appearance ?? null,
        revision: draft.revision,
      },
      base,
    };
  }
  return newest === undefined
    ? { draft: undefined, base }
    : {
        draft: {
          definition: newest.definition,
          appearance: newest.appearance ?? null,
          revision: 0,
        },
        base,
      };
}

function rowKey(edit: VerifiedEdit): { readonly proposalId: string; readonly stepIndex: number } {
  return { proposalId: edit.act === "edit" ? edit.tid : `${edit.tid}.undo`, stepIndex: edit.n };
}

export interface AgentEditSite {
  readonly edit: VerifiedEdit;
  readonly actor: string;
  readonly workspaceId: string;
}

export function agentEditSite(c: Context<ApiEnv>, workspaceId: string): AgentEditSite | undefined {
  const edit = c.get("agentEdit");
  const actor = c.get("adminPrincipal")?.userId;
  if (edit === undefined || actor === undefined) return undefined;
  return { edit, actor, workspaceId };
}

/**
 * The draft-state half of the edit check, inside the save's transaction and before its
 * write. Returns the pre-edit state's digest an Undo token is minted over, or `undefined`
 * where there is nothing an Undo could restore.
 */
export async function admitAgentEdit(
  exec: Executor,
  site: AgentEditSite,
  formId: FormId,
  incoming: { readonly definition: unknown; readonly appearance: Appearance | null | undefined },
): Promise<string | undefined> {
  const { edit } = site;
  const key = rowKey(edit);
  if (await agentStepRecorded(exec, key.proposalId, key.stepIndex)) {
    throw editRefusal("AGENT_EDIT_REPLAYED");
  }
  const state = await heldState(exec, formId);
  const held = state.draft;
  const appearance =
    incoming.appearance === undefined ? (held?.appearance ?? null) : incoming.appearance;

  if (edit.act === "undo") {
    if (
      state.base !== edit.base ||
      held === undefined ||
      held.revision === 0 ||
      (await draftStateDigest(held)) !== edit.post
    ) {
      throw editRefusal("AGENT_UNDO_SUPERSEDED");
    }
    const restored = await draftStateDigest({ definition: incoming.definition, appearance });
    if (restored !== edit.pre) throw editRefusal("AGENT_UNDO_MISMATCH");
    return undefined;
  }

  if (state.base !== edit.base || (held?.revision ?? 0) !== edit.rev) {
    throw editRefusal("AGENT_EDIT_REVISION");
  }
  const definitionMoved =
    held === undefined || canonicalJson(held.definition) !== canonicalJson(incoming.definition);
  const appearanceMoved = canonicalJson(appearance) !== canonicalJson(held?.appearance ?? null);
  // An appearance edit leaves the definition alone and every other op leaves the appearance alone.
  if (edit.op === "appearance" ? definitionMoved : appearanceMoved) {
    throw editRefusal("AGENT_EDIT_OP");
  }
  if ((await draftStateDigest({ definition: incoming.definition, appearance })) !== edit.post) {
    throw editRefusal("AGENT_EDIT_MISMATCH");
  }
  return held === undefined ? undefined : draftStateDigest(held);
}

/**
 * The edit's one audit row, in the save's own transaction, and for an edit the token that
 * undoes it. The Undo token outlives the turn, so its life is the admin session's own cap.
 */
export async function recordAgentEdit(
  exec: Executor,
  site: AgentEditSite,
  saved: FormDraftRow,
  pre: string | undefined,
  deps: { readonly appKey: string; readonly now: Date; readonly undoTtlMs: number },
): Promise<string | null> {
  const { edit } = site;
  const key = rowKey(edit);
  try {
    await writeAgentActionRow(exec, {
      ...key,
      stepCount: EDITS_PER_TURN,
      actor: site.actor,
      workspaceId: site.workspaceId,
      formId: edit.formId,
      kind: rowKind(edit),
      screen: BUILDER_SCREEN,
      proposedAt: new Date(edit.iat),
      confirmedAt: deps.now,
      detail: String(saved.revision),
    });
  } catch (error) {
    // The backstop under the read above: two saves racing on one token.
    if (isUniqueViolation(error)) throw editRefusal("AGENT_EDIT_REPLAYED");
    throw error;
  }
  // With no draft row the read above locked nothing, so a concurrent first save can land
  // before this one; the upsert's own revision is what says the edit applied where bound.
  if (edit.act === "edit" && saved.revision !== edit.rev + 1) {
    throw editRefusal("AGENT_EDIT_REVISION");
  }
  // Read after the write: a publish committed since the pre-write read is visible here, so
  // the token's generation holds without plain saves locking the form.
  const newest = await getLatestPublishedVersion(exec, FormId.parse(edit.formId));
  if ((newest?.version ?? 0) !== edit.base) {
    throw editRefusal(edit.act === "edit" ? "AGENT_EDIT_REVISION" : "AGENT_UNDO_SUPERSEDED");
  }
  if (edit.act !== "edit" || pre === undefined) return null;
  const iat = deps.now.getTime();
  return signEditToken(deps.appKey, {
    v: EDIT_TOKEN_VERSION,
    purpose: EDIT_TOKEN_PURPOSE,
    act: "undo",
    sub: edit.sub,
    formId: edit.formId,
    tid: edit.tid,
    n: edit.n,
    base: edit.base,
    pre,
    post: await draftStateDigest({ definition: saved.definition, appearance: saved.appearance }),
    iat,
    exp: iat + deps.undoTtlMs,
  });
}

export interface AgentAcceptSite {
  readonly accept: AcceptTokenPayload;
  readonly actor: string;
  readonly workspaceId: string;
  /** Writes the refusal line a replay shares with the token checks, by code alone. */
  readonly log: (code: AcceptRefusalCode) => void;
}

function refuseReplay(site: AgentAcceptSite): ApiError {
  site.log("AGENT_ACCEPT_REPLAYED");
  return acceptRefusal("AGENT_ACCEPT_REPLAYED");
}

/**
 * The accept route's token check, before any write: present, signed, unexpired, and issued to this caller
 * for this form. Single use is checked inside the transaction by {@link admitAgentAccept}.
 */
export async function verifyAgentAccept(
  token: string | undefined,
  args: {
    readonly appKey: string;
    readonly now: Date;
    readonly actor: string;
    readonly formId: string;
    readonly log: (code: AcceptRefusalCode) => void;
  },
): Promise<AcceptTokenPayload> {
  const refuse = (code: AcceptRefusalCode) => {
    args.log(code);
    return acceptRefusal(code);
  };
  if (token === undefined || token === "") throw refuse("AGENT_ACCEPT_MISSING");
  const verified = await verifyAcceptToken(args.appKey, token, args.now);
  if (!verified.ok) throw refuse(verified.code);
  if (verified.payload.sub !== args.actor) throw refuse("AGENT_ACCEPT_SUBJECT");
  if (verified.payload.formId !== args.formId) throw refuse("AGENT_ACCEPT_FORM");
  return verified.payload;
}

/** Refuses a token whose row already exists, read inside the accept's transaction before it writes. */
export async function admitAgentAccept(exec: Executor, site: AgentAcceptSite): Promise<void> {
  const key = acceptRowKey(site.accept.pid);
  if (await agentStepRecorded(exec, key.proposalId, key.stepIndex)) {
    throw refuseReplay(site);
  }
}

/** The accept's one row, in its own transaction; the unique key is the backstop under a race. */
export async function recordAgentAccept(
  exec: Executor,
  site: AgentAcceptSite,
  saved: { readonly revision: number },
  confirmedAt: Date,
): Promise<void> {
  try {
    await writeAgentActionRow(exec, {
      ...acceptRowKey(site.accept.pid),
      stepCount: 1,
      actor: site.actor,
      workspaceId: site.workspaceId,
      formId: site.accept.formId,
      kind: ACCEPT_KIND,
      screen: ACCEPT_SCREEN,
      proposedAt: new Date(site.accept.iat),
      confirmedAt,
      detail: String(saved.revision),
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw refuseReplay(site);
    throw error;
  }
}

/** The apply-draft kind's own screen, which is where the docked assistant runs. */
const ACCEPT_SCREEN = "/forms/[formId]";
