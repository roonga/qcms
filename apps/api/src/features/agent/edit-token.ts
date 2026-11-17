/**
 * The token a card-less builder edit carries, and the token its Undo carries. Each binds the user, the form and
 * the turn; an edit binds the draft revision it applies to and the draft state it produces, and an Undo binds the
 * draft states on either side of the edit it reverses.
 */

import { z } from "zod";

import {
  argumentsDigest,
  base64url,
  canonicalJson,
  fromBase64url,
  purposeKey,
} from "./proposal-token.js";

export const EDIT_TOKEN_VERSION = 1;

export const EDIT_TOKEN_PURPOSE = "agent-edit";

export const EDIT_KEY_INFO = "qcms/agent-edit/v1";

/** An edit is applied by the browser as soon as its turn ends, so it gets a proposal's window. */
export const EDIT_TTL_MS = 10 * 60 * 1000;

export const EDITS_PER_TURN = 25;

/** The draft-scoped edit ops a builder turn may yield. A library write is never one of them. */
export const EDIT_OPS = ["question", "step", "rule", "copy", "appearance"] as const;

export type EditOp = (typeof EDIT_OPS)[number];

export const UNDO_KIND = "draft.undo";

export function editKind(op: EditOp): string {
  return `draft.${op}`;
}

/** The kind the row of this edit or Undo records. */
export function rowKind(payload: AgentEditPayload): string {
  return payload.act === "edit" ? editKind(payload.op) : UNDO_KIND;
}

/** Every kind an edit or Undo row records, which the wizard's read selects by. */
export const DRAFT_EDIT_KINDS: readonly string[] = [...EDIT_OPS.map(editKind), UNDO_KIND];

/** The page the rows name, which is the builder's own route. */
export const BUILDER_SCREEN = "/forms/[formId]/build";

const TurnId = z.string().regex(/^edt_[a-z0-9]{8,48}$/u);
const Digest = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const Index = z.number().int().min(0);
const Instant = z.number().int().nonnegative();

const Common = {
  v: z.literal(EDIT_TOKEN_VERSION),
  purpose: z.literal(EDIT_TOKEN_PURPOSE),
  sub: z.string().min(1).max(200),
  formId: z.string().min(1).max(200),
  tid: TurnId,
  n: Index,
  /** The newest published version the draft is built on, 0 for none: a publish restarts the revisions. */
  base: Index,
  iat: Instant,
  exp: Instant,
};

const EditPayload = z.strictObject({
  ...Common,
  act: z.literal("edit"),
  op: z.enum(EDIT_OPS),
  /** The saved draft's revision this edit applies to; 0 is a form with no draft row yet. */
  rev: Index,
  /** The draft state the edit produces, which the save's body must be. */
  post: Digest,
});

const UndoPayload = z.strictObject({
  ...Common,
  act: z.literal("undo"),
  /** The draft state before the edit, which the Undo's body must restore. */
  pre: Digest,
  /** The draft state the edit left, which the saved draft must still hold. */
  post: Digest,
});

const Payload = z.discriminatedUnion("act", [EditPayload, UndoPayload]);

export type EditTokenPayload = z.infer<typeof EditPayload>;
export type UndoTokenPayload = z.infer<typeof UndoPayload>;
export type AgentEditPayload = z.infer<typeof Payload>;

export const EDIT_REFUSAL_CODES = [
  "AGENT_EDIT_DISABLED",
  "AGENT_EDIT_MALFORMED",
  "AGENT_EDIT_SIGNATURE",
  "AGENT_EDIT_SUBJECT",
  "AGENT_EDIT_FORM",
  "AGENT_EDIT_EXPIRED",
  "AGENT_EDIT_ROUTE",
  "AGENT_EDIT_CAP",
  "AGENT_EDIT_REPLAYED",
  "AGENT_EDIT_REVISION",
  "AGENT_EDIT_OP",
  "AGENT_EDIT_MISMATCH",
  "AGENT_UNDO_SUPERSEDED",
  "AGENT_UNDO_MISMATCH",
] as const;

export type EditRefusalCode = (typeof EDIT_REFUSAL_CODES)[number];

export type EditTokenResult =
  | { readonly ok: true; readonly payload: AgentEditPayload }
  | { readonly ok: false; readonly code: EditRefusalCode };

const encoder = new TextEncoder();

function signingKey(appKey: string): Promise<CryptoKey> {
  return purposeKey(appKey, EDIT_KEY_INFO);
}

/** Low level: signs what it is given. {@link mintTurnEditTokens} is where the cap is applied. */
export async function signEditToken(appKey: string, payload: AgentEditPayload): Promise<string> {
  const checked = Payload.parse(payload);
  const body = base64url(encoder.encode(canonicalJson(checked)));
  const mac = await crypto.subtle.sign("HMAC", await signingKey(appKey), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

/** Signature, shape and expiry. The user, the form and the draft are the middleware's and the handler's. */
export async function verifyEditToken(
  appKey: string,
  token: string,
  now: Date,
): Promise<EditTokenResult> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, code: "AGENT_EDIT_MALFORMED" };
  }
  const body = token.slice(0, separator);
  let mac: Uint8Array<ArrayBuffer>;
  let json: string;
  try {
    mac = fromBase64url(token.slice(separator + 1));
    json = new TextDecoder().decode(fromBase64url(body));
  } catch {
    return { ok: false, code: "AGENT_EDIT_MALFORMED" };
  }
  if (!(await crypto.subtle.verify("HMAC", await signingKey(appKey), mac, encoder.encode(body)))) {
    return { ok: false, code: "AGENT_EDIT_SIGNATURE" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, code: "AGENT_EDIT_MALFORMED" };
  }
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "AGENT_EDIT_MALFORMED" };
  if (now.getTime() > parsed.data.exp) return { ok: false, code: "AGENT_EDIT_EXPIRED" };
  return { ok: true, payload: parsed.data };
}

function newTurnId(): string {
  return `edt_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * One token per edit a turn yields, in order, each bound to the draft state it produces. Every
 * save bumps the revision by one, so edit `i` is bound to `startRevision + i`: a human save, an
 * Undo or a skipped edit in between leaves every later token stale. The turn id is fresh on
 * every call, so the per-turn cap holds only if a turn mints once.
 */
export async function mintTurnEditTokens(
  appKey: string,
  args: {
    readonly sub: string;
    readonly formId: string;
    readonly baseVersion: number;
    readonly startRevision: number;
    readonly edits: readonly { readonly op: EditOp; readonly post: string }[];
    readonly issuedAt: Date;
  },
): Promise<{ readonly turnId: string; readonly tokens: readonly string[] }> {
  if (args.edits.length > EDITS_PER_TURN) {
    throw new Error("A turn yields at most EDITS_PER_TURN draft edits");
  }
  const tid = newTurnId();
  const iat = args.issuedAt.getTime();
  const tokens: string[] = [];
  for (const [n, { op, post }] of args.edits.entries()) {
    tokens.push(
      await signEditToken(appKey, {
        v: EDIT_TOKEN_VERSION,
        purpose: EDIT_TOKEN_PURPOSE,
        act: "edit",
        sub: args.sub,
        formId: args.formId,
        tid,
        n,
        base: args.baseVersion,
        op,
        rev: args.startRevision + n,
        post,
        iat,
        exp: iat + EDIT_TTL_MS,
      }),
    );
  }
  return { turnId: tid, tokens };
}

/** The draft state an edit or Undo is checked against: the definition and the appearance, nothing else. */
export function draftStateDigest(state: {
  readonly definition: unknown;
  readonly appearance: unknown;
}): Promise<string> {
  return argumentsDigest({ definition: state.definition, appearance: state.appearance ?? null });
}
