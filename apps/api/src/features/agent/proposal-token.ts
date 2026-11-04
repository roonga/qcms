/** Bind each ordered step's action kind, displayed argument digest, and environment in the HMAC token. */

export const PROPOSAL_TOKEN_VERSION = 1;

export const PROPOSAL_TOKEN_PURPOSE = "agent-proposal";

/** Derive distinct keys per purpose rather than sharing configured key material. */
export const PROPOSAL_KEY_INFO = "qcms/agent-proposal/v1";

/** Checked on step 0 only; later steps are bounded by step 0's recorded confirmation. */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export const PROPOSAL_MAX_STEPS = 25;

/** One step's binding. `environment` is the environment that step acts in, not the plan's. */
export interface ProposalStepBinding {
  readonly kind: string;
  readonly argsDigest: string;
  readonly environment: string;
}

export interface ProposalTokenPayload {
  readonly v: typeof PROPOSAL_TOKEN_VERSION;
  readonly purpose: typeof PROPOSAL_TOKEN_PURPOSE;
  /** The principal the proposal was issued to; a token cannot be carried to another session. */
  readonly sub: string;
  readonly pid: string;
  readonly steps: readonly ProposalStepBinding[];
  readonly formId?: string;
  /**
   * The `form_drafts.revision` the plan's steps were built from, when they were built from
   * the saved draft at all. Every step of such a plan is refused once the draft moves, so a
   * pin removed after the card was proposed cannot still be published.
   */
  readonly draftRevision?: number;
  readonly iat: number;
  readonly exp: number;
}

/** A symbolic reference to a field of an earlier step's result, never a value. */
export interface StepReference {
  readonly fromStep: number;
  readonly field: string;
}

export function isStepReference(value: unknown): value is StepReference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    typeof candidate.fromStep === "number" &&
    Number.isInteger(candidate.fromStep) &&
    candidate.fromStep >= 0 &&
    typeof candidate.field === "string"
  );
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Key order is sorted at every depth and `undefined` members are dropped, so a digest is a
 * property of the arguments rather than of how a caller happened to serialise them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
    return `{${members.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Proposal arguments carry a non-finite number");
  }
  if (value === undefined) throw new Error("Proposal arguments carry undefined");
  return JSON.stringify(value);
}

/** SHA-256 over the canonical JSON of one step's arguments, references kept symbolic. */
export async function argumentsDigest(args: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJson(args)));
  return base64url(new Uint8Array(digest));
}

/**
 * HKDF-SHA-256 over `QCMS_APP_KEY` under {@link PROPOSAL_KEY_INFO}. No salt, because the
 * label is what separates this purpose from every other use of the same key.
 */
async function signingKey(appKey: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(appKey), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(PROPOSAL_KEY_INFO),
    },
    material,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

interface ProposalTokenArgs {
  readonly sub: string;
  readonly pid: string;
  readonly steps: readonly ProposalStepBinding[];
  readonly formId?: string | undefined;
  readonly draftRevision?: number | undefined;
  readonly issuedAt: Date;
}

function payloadOf(args: ProposalTokenArgs): ProposalTokenPayload {
  const iat = args.issuedAt.getTime();
  return {
    v: PROPOSAL_TOKEN_VERSION,
    purpose: PROPOSAL_TOKEN_PURPOSE,
    sub: args.sub,
    pid: args.pid,
    steps: args.steps,
    ...(args.formId === undefined ? {} : { formId: args.formId }),
    ...(args.draftRevision === undefined ? {} : { draftRevision: args.draftRevision }),
    iat,
    exp: iat + PROPOSAL_TTL_MS,
  };
}

export async function signProposalToken(appKey: string, args: ProposalTokenArgs): Promise<string> {
  if (args.steps.length === 0) throw new Error("A proposal token carries at least one step");
  if (args.steps.length > PROPOSAL_MAX_STEPS) {
    throw new Error("A proposal token carries at most PROPOSAL_MAX_STEPS steps");
  }
  const body = base64url(encoder.encode(canonicalJson(payloadOf(args))));
  const key = await signingKey(appKey);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

export const PROPOSAL_REFUSAL_CODES = [
  "AGENT_PROPOSAL_DISABLED",
  "AGENT_PROPOSAL_MALFORMED",
  "AGENT_PROPOSAL_SIGNATURE",
  "AGENT_PROPOSAL_SUBJECT",
  "AGENT_PROPOSAL_EXPIRED",
  "AGENT_PROPOSAL_WINDOW",
  "AGENT_PROPOSAL_STEP_RANGE",
  "AGENT_PROPOSAL_ROUTE",
  "AGENT_PROPOSAL_ARGUMENTS",
  "AGENT_PROPOSAL_REFERENCE",
  "AGENT_PROPOSAL_ORDER",
  "AGENT_PROPOSAL_ENVIRONMENT",
  "AGENT_PROPOSAL_DRAFT",
] as const;

export type ProposalRefusalCode = (typeof PROPOSAL_REFUSAL_CODES)[number];

export type ProposalTokenResult =
  | { readonly ok: true; readonly payload: ProposalTokenPayload }
  | { readonly ok: false; readonly code: ProposalRefusalCode };

function refused(code: ProposalRefusalCode): ProposalTokenResult {
  return { ok: false, code };
}

function parsedStep(raw: unknown): ProposalStepBinding | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const { kind, argsDigest, environment } = row;
  if (typeof kind !== "string" || kind === "") return undefined;
  if (typeof argsDigest !== "string" || argsDigest === "") return undefined;
  if (typeof environment !== "string" || environment === "") return undefined;
  return { kind, argsDigest, environment };
}

function parsedSteps(raw: unknown): ProposalStepBinding[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > PROPOSAL_MAX_STEPS) return undefined;
  const steps: ProposalStepBinding[] = [];
  for (const entry of raw) {
    const step = parsedStep(entry);
    if (step === undefined) return undefined;
    steps.push(step);
  }
  return steps;
}

function isDraftRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function parsedPayload(raw: unknown): ProposalTokenPayload | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== PROPOSAL_TOKEN_VERSION) return undefined;
  if (candidate.purpose !== PROPOSAL_TOKEN_PURPOSE) return undefined;
  if (typeof candidate.sub !== "string" || candidate.sub === "") return undefined;
  if (typeof candidate.pid !== "string" || candidate.pid === "") return undefined;
  if (typeof candidate.iat !== "number" || typeof candidate.exp !== "number") return undefined;
  if (candidate.formId !== undefined && typeof candidate.formId !== "string") return undefined;
  if (candidate.draftRevision !== undefined && !isDraftRevision(candidate.draftRevision)) {
    return undefined;
  }
  const steps = parsedSteps(candidate.steps);
  if (steps === undefined) return undefined;
  return {
    v: PROPOSAL_TOKEN_VERSION,
    purpose: PROPOSAL_TOKEN_PURPOSE,
    sub: candidate.sub,
    pid: candidate.pid,
    steps,
    ...(candidate.formId === undefined ? {} : { formId: candidate.formId }),
    ...(isDraftRevision(candidate.draftRevision) ? { draftRevision: candidate.draftRevision } : {}),
    iat: candidate.iat,
    exp: candidate.exp,
  };
}

/**
 * The proposal id a token claims, read without verifying it. Its only use is selecting
 * the `control.agent_actions` rows the verified check then reads: a forged id selects rows
 * of another proposal, which the signature check refuses a moment later.
 */
export function unverifiedProposalId(token: string): string | undefined {
  const separator = token.indexOf(".");
  if (separator <= 0) return undefined;
  try {
    const raw: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64url(token.slice(0, separator))),
    );
    const pid = (raw as { pid?: unknown } | null)?.pid;
    return typeof pid === "string" && pid !== "" ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Signature and shape only. Step order, route, arguments and environment are the middleware's. */
export async function verifyProposalToken(
  appKey: string,
  token: string,
): Promise<ProposalTokenResult> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return refused("AGENT_PROPOSAL_MALFORMED");
  const body = token.slice(0, separator);
  let mac: Uint8Array<ArrayBuffer>;
  let json: string;
  try {
    mac = fromBase64url(token.slice(separator + 1));
    json = new TextDecoder().decode(fromBase64url(body));
  } catch {
    return refused("AGENT_PROPOSAL_MALFORMED");
  }

  const key = await signingKey(appKey);
  if (!(await crypto.subtle.verify("HMAC", key, mac, encoder.encode(body)))) {
    return refused("AGENT_PROPOSAL_SIGNATURE");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return refused("AGENT_PROPOSAL_MALFORMED");
  }
  const payload = parsedPayload(raw);
  return payload === undefined ? refused("AGENT_PROPOSAL_MALFORMED") : { ok: true, payload };
}
