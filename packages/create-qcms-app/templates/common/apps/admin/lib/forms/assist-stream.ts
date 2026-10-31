import type { FormIssue } from "./types.ts";
import { parseIssues } from "./issues.ts";

/**
 * The assist SSE stream, parsed client-side (task 041).
 *
 * The API relays `apps/api/src/features/agent/types.ts`'s `AssistEvent` union as
 * one `event: <type>\ndata: <json>\n\n` frame per item. This module redeclares that
 * union rather than importing it: the admin has no path across the app boundary (R2,
 * and there is no shared package for it), so what lives here is a *view* of the wire
 * bytes, the same stance `lib/forms/issues.ts` and `lib/server/forms.ts` take on every
 * other API payload. `FormIssue` is the one exception, reused rather than redeclared,
 * because a proposal's `issues` are literally the same `PublishIssue[]` shape the
 * builder's own validation panel already renders.
 *
 * `proposedDraft` and `newQuestions` stay `unknown` here on purpose: turning them into
 * something the panel can diff is `lib/forms/assist-diff.ts`'s job, not this parser's.
 */

export interface AssistTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AssistProposal {
  /** The kernel's `FormDefinition`, as JSON. Parsed by `assist-diff.ts`, not here. */
  readonly proposedDraft: unknown;
  /** The kernel's `QuestionDefinition[]` for any questions the proposal introduces. */
  readonly newQuestions: readonly unknown[];
  readonly rationale: string;
  /** What would block a publish. */
  readonly issues: readonly FormIssue[];
  /**
   * What would not block a publish but may not behave as written (issue #123).
   *
   * Carried because the panel must show the same two lists the builder shows for
   * the same draft: a proposal card that said "validation passes" over a draft
   * the validation panel flags one Accept later would be claiming more than the
   * server told it.
   */
  readonly warnings: readonly FormIssue[];
}

/**
 * One step of a proposed action or plan, as the `action` and `plan` events carry it.
 * `args` stays an opaque map: the card renders each argument from the kind and
 * the catalog, and an argument may be a `{ fromStep, field }` reference the card resolves
 * from the earlier step's own returned state.
 */
export interface AgentCardTemplate {
  readonly titleKey: string;
  readonly consequenceKeys: readonly string[];
  /** The heading-row control the proposal marker sits on, or absent for none. */
  readonly headingControl?: string;
}

export interface AgentPlanStep {
  readonly kind: string;
  /** The screen whose own server action Confirm calls for this step. */
  readonly screen: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly environment: string;
  /** A step whose arguments include a secret the user types on the screen itself. */
  readonly handOff: boolean;
  readonly card: AgentCardTemplate;
  /** The non-secret fields this step may report to the next turn (SEC-17 section 7.6). */
  readonly resultAllowlist: readonly string[];
}

export interface AgentProposal {
  readonly proposalId: string;
  /** Absent when every step is a hand-off, which carries no token. */
  readonly token: string | undefined;
  readonly steps: readonly AgentPlanStep[];
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly formId: string | undefined;
}

/**
 * The API's assist error codes, mirrored here.
 *
 * Mirrored rather than imported: this app is a strict BFF and takes no value
 * import from the API (R2). The mirror is kept honest by
 * `assist-error-codes.test.ts`, which reads the API's own declaration as text and
 * fails when the two lists diverge - and which also asserts every code has copy,
 * because a code the panel cannot render is the defect `STEP_LIMIT` was.
 */
export const ASSIST_ERROR_CODES = [
  "PROVIDER_ERROR",
  "PROVIDER_REJECTED",
  "NO_PROPOSAL",
  "REFUSED",
  "LENGTH",
  "STEP_LIMIT",
] as const;

export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

export type AssistEvent =
  | {
      readonly type: "status";
      readonly phase: "thinking" | "tool";
      readonly tool?: string;
      /** A `tool` status's per-turn step ordinal, which its `tool-outcome` names. */
      readonly step?: number;
    }
  | { readonly type: "tool-outcome"; readonly step: number; readonly outcome: "done" | "failed" }
  /** A chunk of prose. `segment` is the provider's text-segment id; absent, every delta folds into one segment. */
  | { readonly type: "text"; readonly delta: string; readonly segment?: string }
  /** A chunk of the provider's reasoning summary; the client renders it because events came, never from a flag (ADR-24). */
  | { readonly type: "reasoning"; readonly delta: string }
  | { readonly type: "reasoning-end" }
  | { readonly type: "tool-rejected"; readonly tool: string }
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly steps: number;
    }
  | { readonly type: "proposal"; readonly proposal: AssistProposal }
  /** One proposed action, which is a plan of one step. */
  | { readonly type: "action"; readonly proposal: AgentProposal }
  | { readonly type: "plan"; readonly proposal: AgentProposal }
  | { readonly type: "error"; readonly code: AssistErrorCode; readonly message: string };

/** SSE frames are separated by one blank line, whatever their own line endings are. */
const FRAME_SEPARATOR = "\n\n";

/**
 * Read every `AssistEvent` out of an SSE body, in the order the server sent them.
 *
 * A chunk from a browser `fetch` call's response body is not a frame: it is a slab of bytes that can split
 * a frame across two chunks, or carry several frames at once, at the network's own
 * discretion. `TextDecoder`'s `stream: true` keeps a partial multi-byte character
 * across chunk boundaries, and the buffer here keeps a partial *frame* the same way -
 * both are read out only once a complete unit is available. A frame this parser
 * cannot make sense of (no `data:` line, or a `data:` payload that is not the JSON
 * shape one of the variants above expects) is skipped rather than thrown: one
 * event this build does not recognise should not end a stream the rest of which is
 * perfectly good.
 */
export async function* readAssistEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf(FRAME_SEPARATOR);
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + FRAME_SEPARATOR.length);
        const event = parseFrame(frame);
        if (event !== undefined) yield event;
        boundary = buffer.indexOf(FRAME_SEPARATOR);
      }
    }
    // A stream may end without a trailing blank line after its last frame. Flush the
    // decoder's own pending bytes and give whatever is left one final try.
    buffer += decoder.decode();
    const trailing = parseFrame(buffer);
    if (trailing !== undefined) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

/** One `event: <type>\ndata: <json>` frame, or `undefined` when it cannot be read. */
function parseFrame(frame: string): AssistEvent | undefined {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return undefined;
  }
  return toAssistEvent(parsed);
}

function isKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAssistEvent(raw: unknown): AssistEvent | undefined {
  if (!isKeyedObject(raw)) return undefined;

  switch (raw["type"]) {
    case "status":
      return toStatusEvent(raw);
    case "tool-outcome":
      return toToolOutcomeEvent(raw);
    case "text":
      return toTextEvent(raw);
    case "reasoning":
      return typeof raw["delta"] === "string"
        ? { type: "reasoning", delta: raw["delta"] }
        : undefined;
    case "reasoning-end":
      return { type: "reasoning-end" };
    case "tool-rejected":
      return typeof raw["tool"] === "string"
        ? { type: "tool-rejected", tool: raw["tool"] }
        : undefined;
    case "usage":
      return toUsageEvent(raw);
    case "proposal": {
      const proposal = toAssistProposal(raw["proposal"]);
      return proposal === undefined ? undefined : { type: "proposal", proposal };
    }
    case "action":
    case "plan": {
      const proposal = toAgentProposal(raw["proposal"]);
      if (proposal === undefined) return undefined;
      return raw["type"] === "action" ? { type: "action", proposal } : { type: "plan", proposal };
    }
    case "error":
      return toErrorEvent(raw);
    default:
      return undefined;
  }
}

function toTextEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const delta = raw["delta"];
  if (typeof delta !== "string") return undefined;
  const segment = raw["segment"];
  return { type: "text", delta, ...(typeof segment === "string" ? { segment } : {}) };
}

function isStepOrdinal(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function toStatusEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const phase = raw["phase"];
  if (phase !== "thinking" && phase !== "tool") return undefined;
  const tool = raw["tool"];
  const step = raw["step"];
  return {
    type: "status",
    phase,
    ...(typeof tool === "string" ? { tool } : {}),
    ...(isStepOrdinal(step) ? { step } : {}),
  };
}

function toToolOutcomeEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const step = raw["step"];
  const outcome = raw["outcome"];
  if (!isStepOrdinal(step) || (outcome !== "done" && outcome !== "failed")) return undefined;
  return { type: "tool-outcome", step, outcome };
}

function toUsageEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const inputTokens = raw["inputTokens"];
  const outputTokens = raw["outputTokens"];
  const steps = raw["steps"];
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    typeof steps !== "number"
  ) {
    return undefined;
  }
  return { type: "usage", inputTokens, outputTokens, steps };
}

function toErrorEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const code = raw["code"];
  const message = raw["message"];
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  const known = ASSIST_ERROR_CODES.find((candidate) => candidate === code);
  return known === undefined ? undefined : { type: "error", code: known, message };
}

function textList(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toCardTemplate(raw: unknown): AgentCardTemplate | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const titleKey = raw["titleKey"];
  if (typeof titleKey !== "string" || titleKey === "") return undefined;
  const headingControl = raw["headingControl"];
  return {
    titleKey,
    consequenceKeys: textList(raw["consequenceKeys"]),
    ...(typeof headingControl === "string" ? { headingControl } : {}),
  };
}

/**
 * One step, or `undefined` when the frame cannot be read. A step this build cannot read
 * drops the whole proposal rather than showing a plan with a gap in it: the card's second
 * rule is that every step is displayed, so a partial plan must not reach the screen.
 */
function toAgentPlanStep(raw: unknown): AgentPlanStep | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const kind = raw["kind"];
  const screen = raw["screen"];
  const environment = raw["environment"];
  const args = raw["args"];
  const card = toCardTemplate(raw["card"]);
  if (typeof kind !== "string" || kind === "") return undefined;
  if (typeof screen !== "string" || typeof environment !== "string") return undefined;
  if (!isKeyedObject(args) || card === undefined) return undefined;
  return {
    kind,
    screen,
    args,
    environment,
    handOff: raw["handOff"] === true,
    card,
    resultAllowlist: textList(raw["resultAllowlist"]),
  };
}

function toAgentProposal(raw: unknown): AgentProposal | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const proposalId = raw["proposalId"];
  const proposedAt = raw["proposedAt"];
  const expiresAt = raw["expiresAt"];
  if (typeof proposalId !== "string" || proposalId === "") return undefined;
  if (typeof proposedAt !== "string" || typeof expiresAt !== "string") return undefined;
  if (!Array.isArray(raw["steps"]) || raw["steps"].length === 0) return undefined;

  const steps: AgentPlanStep[] = [];
  for (const entry of raw["steps"]) {
    const step = toAgentPlanStep(entry);
    if (step === undefined) return undefined;
    steps.push(step);
  }
  const token = raw["token"];
  const formId = raw["formId"];
  return {
    proposalId,
    token: typeof token === "string" && token !== "" ? token : undefined,
    steps,
    proposedAt,
    expiresAt,
    formId: typeof formId === "string" ? formId : undefined,
  };
}

function toAssistProposal(raw: unknown): AssistProposal | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const rationale = raw["rationale"];
  const proposedDraft = raw["proposedDraft"];
  if (typeof rationale !== "string" || !isKeyedObject(proposedDraft)) return undefined;
  const newQuestions = Array.isArray(raw["newQuestions"]) ? raw["newQuestions"] : [];
  return {
    proposedDraft,
    newQuestions,
    rationale,
    issues: parseIssues(raw["issues"]),
    warnings: parseIssues(raw["warnings"]),
  };
}
