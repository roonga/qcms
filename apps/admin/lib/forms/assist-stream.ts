import type { FormIssue } from "./types.ts";
import { parseIssues } from "./issues.ts";

/**
 * The assist SSE stream, parsed client-side (task 041, wireframe `admin-agent-panel.md`).
 *
 * The API relays `apps/api/src/features/forms/assist/types.ts`'s `AssistEvent` union as
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
  readonly issues: readonly FormIssue[];
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
  "NO_PROPOSAL",
  "REFUSED",
  "LENGTH",
  "STEP_LIMIT",
] as const;

export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

export type AssistEvent =
  | { readonly type: "status"; readonly phase: "thinking" | "tool"; readonly tool?: string }
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "tool-rejected"; readonly tool: string }
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly steps: number;
    }
  | { readonly type: "proposal"; readonly proposal: AssistProposal }
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
 * shape one of the six variants above expects) is skipped rather than thrown: one
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
    case "text":
      return typeof raw["delta"] === "string" ? { type: "text", delta: raw["delta"] } : undefined;
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
    case "error":
      return toErrorEvent(raw);
    default:
      return undefined;
  }
}

function toStatusEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const phase = raw["phase"];
  if (phase !== "thinking" && phase !== "tool") return undefined;
  const tool = raw["tool"];
  return typeof tool === "string" ? { type: "status", phase, tool } : { type: "status", phase };
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
  };
}
