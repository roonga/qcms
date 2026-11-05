import type { FormIssue } from "./types.ts";
import { parseIssues } from "./issues.ts";

// Mirror the API wire shape without cross-app imports. Keep proposed draft bytes unknown until the shared draft reader parses them.

export interface AssistTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

// Preserve both server advisory lists; a card cannot claim more safety than the API reported.
export interface AgentDraftProposal {
  readonly definition: unknown;

  readonly newQuestions: readonly unknown[];

  readonly issues: readonly FormIssue[];

  readonly warnings: readonly FormIssue[];
}

// Keep args opaque: a value may reference an earlier step result rather than carrying a literal.
export interface AgentCardTemplate {
  readonly titleKey: string;
  readonly consequenceKeys: readonly string[];

  readonly headingControl?: string;

  /* A draft belongs to no environment, so its card shows no environment line. */
  readonly hideEnvironment?: boolean;

  readonly typedConfirmation?: string;

  readonly createdLink?: AgentCreatedLink;
}

export interface AgentCreatedLink {
  readonly screen: string;
  readonly field: string;
}

export interface AgentPlanStep {
  readonly kind: string;

  readonly screen: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly environment: string;

  readonly handOff: boolean;

  readonly local: boolean;

  readonly draft?: AgentDraftProposal;
  readonly card: AgentCardTemplate;
  // Only these non-secret result fields may be reported to a subsequent assistant turn.
  readonly resultAllowlist: readonly string[];
}

export interface AgentProposal {
  readonly proposalId: string;
  // Hand-off-only plans have no confirmation token.
  readonly token: string | undefined;
  readonly steps: readonly AgentPlanStep[];
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly formId: string | undefined;

  readonly currentEnvironment: string;
}

// assist-error-codes tests compare this wire mirror with API declarations and require distinct catalog copy.
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

      readonly step?: number;
    }
  | { readonly type: "tool-outcome"; readonly step: number; readonly outcome: "done" | "failed" }
  | { readonly type: "text"; readonly delta: string; readonly segment?: string }
  | { readonly type: "reasoning"; readonly delta: string }
  | { readonly type: "reasoning-end" }
  | { readonly type: "tool-rejected"; readonly tool: string }
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly steps: number;
    }
  | { readonly type: "action"; readonly proposal: AgentProposal }
  | { readonly type: "plan"; readonly proposal: AgentProposal }
  | { readonly type: "error"; readonly code: AssistErrorCode; readonly message: string };

const FRAME_SEPARATOR = "\n\n";

// Fetch chunks can split frames and UTF-8 characters. Decode incrementally and buffer frames rather than treating each chunk as an event.
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
    // Flush pending decoder bytes and an unterminated final frame when the stream closes.
    buffer += decoder.decode();
    const trailing = parseFrame(buffer);
    if (trailing !== undefined) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

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

function toCreatedLink(raw: unknown): AgentCreatedLink | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const screen = raw["screen"];
  const field = raw["field"];
  if (typeof screen !== "string" || screen === "") return undefined;
  return typeof field === "string" && field !== "" ? { screen, field } : undefined;
}

function toCardTemplate(raw: unknown): AgentCardTemplate | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const titleKey = raw["titleKey"];
  if (typeof titleKey !== "string" || titleKey === "") return undefined;
  const headingControl = raw["headingControl"];
  const typedConfirmation = raw["typedConfirmation"];
  const createdLink = toCreatedLink(raw["createdLink"]);
  return {
    titleKey,
    consequenceKeys: textList(raw["consequenceKeys"]),
    ...(typeof headingControl === "string" ? { headingControl } : {}),
    ...(typeof typedConfirmation === "string" ? { typedConfirmation } : {}),
    ...(createdLink === undefined ? {} : { createdLink }),
  };
}

// An unreadable step invalidates the whole proposal; never show a confirmation plan with omitted steps.
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
  const draft = toDraftProposal(raw["draft"]);
  return {
    kind,
    screen,
    args,
    environment,
    handOff: raw["handOff"] === true,
    local: raw["local"] === true,
    ...(draft === undefined ? {} : { draft }),
    card,
    resultAllowlist: textList(raw["resultAllowlist"]),
  };
}

function toDraftProposal(raw: unknown): AgentDraftProposal | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const definition = raw["definition"];
  if (!isKeyedObject(definition)) return undefined;
  return {
    definition,
    newQuestions: Array.isArray(raw["newQuestions"]) ? raw["newQuestions"] : [],
    issues: parseIssues(raw["issues"]),
    warnings: parseIssues(raw["warnings"]),
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
  const currentEnvironment = raw["currentEnvironment"];
  // Do not invent a missing destination environment: confirmation is bound to the selection under which the turn ran.
  if (typeof currentEnvironment !== "string" || currentEnvironment === "") return undefined;
  return {
    proposalId,
    token: typeof token === "string" && token !== "" ? token : undefined,
    steps,
    proposedAt,
    expiresAt,
    formId: typeof formId === "string" ? formId : undefined,
    currentEnvironment,
  };
}
