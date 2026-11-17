/**
 * The token an apply-draft step carries to the docked assistant's accept route. It binds the user, the form,
 * the proposal and an expiry, and its row's unique key makes it single-use.
 */

import { z } from "zod";

import { ApiError } from "../../errors.js";
import {
  base64url,
  canonicalJson,
  fromBase64url,
  PROPOSAL_TTL_MS,
  purposeKey,
} from "./proposal-token.js";

export const ACCEPT_TOKEN_VERSION = 1;

export const ACCEPT_TOKEN_PURPOSE = "agent-accept";

export const ACCEPT_KEY_INFO = "qcms/agent-accept/v1";

/** The accept follows Confirm, so it gets the proposal's own window. */
export const ACCEPT_TTL_MS = PROPOSAL_TTL_MS;

export const ACCEPT_HEADER = "x-qcms-agent-accept";

/** The kind the accept's row records. */
export const ACCEPT_KIND = "apply-draft";

/** A plan's own token steps hold `(pid, i)`, so the accept's row keeps a key of its own. */
export function acceptRowKey(pid: string): {
  readonly proposalId: string;
  readonly stepIndex: number;
} {
  return { proposalId: `${pid}.accept`, stepIndex: 0 };
}

const Payload = z.strictObject({
  v: z.literal(ACCEPT_TOKEN_VERSION),
  purpose: z.literal(ACCEPT_TOKEN_PURPOSE),
  sub: z.string().min(1).max(200),
  formId: z.string().min(1).max(200),
  pid: z.string().regex(/^prp_[a-z0-9]{8,48}$/u),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

export type AcceptTokenPayload = z.infer<typeof Payload>;

export const ACCEPT_REFUSAL_CODES = [
  "AGENT_ACCEPT_MISSING",
  "AGENT_ACCEPT_MALFORMED",
  "AGENT_ACCEPT_SIGNATURE",
  "AGENT_ACCEPT_SUBJECT",
  "AGENT_ACCEPT_FORM",
  "AGENT_ACCEPT_EXPIRED",
  "AGENT_ACCEPT_REPLAYED",
] as const;

export type AcceptRefusalCode = (typeof ACCEPT_REFUSAL_CODES)[number];

export type AcceptTokenResult =
  | { readonly ok: true; readonly payload: AcceptTokenPayload }
  | { readonly ok: false; readonly code: AcceptRefusalCode };

const encoder = new TextEncoder();

function signingKey(appKey: string): Promise<CryptoKey> {
  return purposeKey(appKey, ACCEPT_KEY_INFO);
}

export async function signAcceptToken(
  appKey: string,
  args: {
    readonly sub: string;
    readonly formId: string;
    readonly pid: string;
    readonly issuedAt: Date;
  },
): Promise<string> {
  const iat = args.issuedAt.getTime();
  const payload = Payload.parse({
    v: ACCEPT_TOKEN_VERSION,
    purpose: ACCEPT_TOKEN_PURPOSE,
    sub: args.sub,
    formId: args.formId,
    pid: args.pid,
    iat,
    exp: iat + ACCEPT_TTL_MS,
  });
  const body = base64url(encoder.encode(canonicalJson(payload)));
  const mac = await crypto.subtle.sign("HMAC", await signingKey(appKey), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

/** Signature, shape and expiry. The user and the form are the caller's to compare. */
export async function verifyAcceptToken(
  appKey: string,
  token: string,
  now: Date,
): Promise<AcceptTokenResult> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, code: "AGENT_ACCEPT_MALFORMED" };
  }
  const body = token.slice(0, separator);
  let mac: Uint8Array<ArrayBuffer>;
  let json: string;
  try {
    mac = fromBase64url(token.slice(separator + 1));
    json = new TextDecoder().decode(fromBase64url(body));
  } catch {
    return { ok: false, code: "AGENT_ACCEPT_MALFORMED" };
  }
  if (!(await crypto.subtle.verify("HMAC", await signingKey(appKey), mac, encoder.encode(body)))) {
    return { ok: false, code: "AGENT_ACCEPT_SIGNATURE" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, code: "AGENT_ACCEPT_MALFORMED" };
  }
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "AGENT_ACCEPT_MALFORMED" };
  if (now.getTime() > parsed.data.exp) return { ok: false, code: "AGENT_ACCEPT_EXPIRED" };
  return { ok: true, payload: parsed.data };
}

function message(code: AcceptRefusalCode): string {
  switch (code) {
    case "AGENT_ACCEPT_EXPIRED":
      return "That proposal is more than ten minutes old. Ask the assistant again.";
    case "AGENT_ACCEPT_REPLAYED":
      return "That proposal has already been applied.";
    default:
      return "Only a proposal the assistant made can be applied here.";
  }
}

export function acceptRefusal(code: AcceptRefusalCode): ApiError {
  return new ApiError(code, 403, message(code));
}
