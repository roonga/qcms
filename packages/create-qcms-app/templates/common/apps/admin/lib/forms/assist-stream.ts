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

  /* Which step of this plan creates each new question, so a pin can name it. */
  readonly createdBy?: readonly { readonly questionId: string; readonly step: number }[];

  /* The single-use token the accept route requires; only the apply-draft step carries one. */
  readonly acceptToken?: string;
}

// Keep args opaque: a value may reference an earlier step result rather than carrying a literal.
export interface AgentCardTemplate {
  readonly titleKey: string;
  readonly consequenceKeys: readonly string[];

  readonly headingControl?: string;

  /* A draft belongs to no environment, so its card shows no environment line. */
  readonly hideEnvironment?: boolean;

  readonly typedConfirmation?: string;

  /** The argument the person types on the card itself, which no proposal may name (SEC-18 W2). */
  readonly typedInput?: string;

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

/* Display context, not an argument: the card shows a workspace by name, and the digest binds the id. */
export interface AgentWorkspaceName {
  readonly workspaceId: string;
  readonly name: string;
}

export interface AgentProposal {
  readonly proposalId: string;
  // Hand-off-only plans have no confirmation token.
  readonly token: string | undefined;
  readonly steps: readonly AgentPlanStep[];
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly formId: string | undefined;

  readonly workspaces?: readonly AgentWorkspaceName[];

  readonly currentEnvironment: string;

  /* The plan's outcome as the assistant wrote it. The API refuses one carrying an id or a
     builder word, so a card that has it can show it as its heading. */
  readonly title?: string;

  /* The assistant said a second card has to follow this one, so the panel runs another turn
     once every step has run rather than waiting to be asked again. */
  readonly thenAnother?: boolean;
}

export const BUILDER_EDIT_OPS = ["question", "step", "rule", "copy", "appearance"] as const;

export type BuilderEditOp = (typeof BUILDER_EDIT_OPS)[number];

/** One card-less edit. `definition` is kept as parsed: its token binds that exact post-state. */
export interface BuilderEdit {
  readonly index: number;
  readonly op: BuilderEditOp;
  readonly token: string;
  readonly definition: Readonly<Record<string, unknown>>;
  /** Present once a turn has changed the appearance: the save sends it with the definition. */
  readonly appearance?: Readonly<Record<string, unknown>>;
}

export interface BuilderEdits {
  readonly formId: string;
  readonly turnId: string;
  readonly edits: readonly BuilderEdit[];
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
  | { readonly type: "plan"; readonly proposal: AgentProposal }
  | ({ readonly type: "edits" } & BuilderEdits)
  | { readonly type: "open-wizard"; readonly formId: string; readonly returnTo: string }
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
    case "plan": {
      const proposal = toAgentProposal(raw["proposal"]);
      return proposal === undefined ? undefined : { type: "plan", proposal };
    }
    case "error":
      return toErrorEvent(raw);
    case "edits":
      return toEditsEvent(raw);
    case "open-wizard":
      return typeof raw["formId"] === "string" && typeof raw["returnTo"] === "string"
        ? { type: "open-wizard", formId: raw["formId"], returnTo: raw["returnTo"] }
        : undefined;
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

function toBuilderEdit(raw: unknown): BuilderEdit | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const { index, op, token, definition, appearance } = raw;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  const known = BUILDER_EDIT_OPS.find((candidate) => candidate === op);
  if (known === undefined || typeof token !== "string" || token === "") return undefined;
  if (!isKeyedObject(definition) || Array.isArray(definition)) return undefined;
  const look = isKeyedObject(appearance) && !Array.isArray(appearance) ? appearance : undefined;
  if (known === "appearance" && look === undefined) return undefined;
  return {
    index,
    op: known,
    token,
    definition,
    ...(look === undefined ? {} : { appearance: look }),
  };
}

// An unreadable edit drops the whole set: a later edit's token binds the state an earlier one left.
function toEditsEvent(raw: Record<string, unknown>): AssistEvent | undefined {
  const { formId, turnId, edits } = raw;
  if (typeof formId !== "string" || typeof turnId !== "string" || !Array.isArray(edits)) {
    return undefined;
  }
  const parsed: BuilderEdit[] = [];
  for (const entry of edits) {
    const edit = toBuilderEdit(entry);
    if (edit === undefined) return undefined;
    parsed.push(edit);
  }
  return parsed.length === 0 ? undefined : { type: "edits", formId, turnId, edits: parsed };
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
  const typedInput = raw["typedInput"];
  const createdLink = toCreatedLink(raw["createdLink"]);
  return {
    titleKey,
    consequenceKeys: textList(raw["consequenceKeys"]),
    ...(typeof headingControl === "string" ? { headingControl } : {}),
    ...(typeof typedConfirmation === "string" ? { typedConfirmation } : {}),
    ...(typeof typedInput === "string" && typedInput !== "" ? { typedInput } : {}),
    ...(createdLink === undefined ? {} : { createdLink }),
    ...(raw["hideEnvironment"] === true ? { hideEnvironment: true } : {}),
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
  const createdBy = toCreatedBy(raw["createdBy"]);
  const acceptToken = raw["acceptToken"];
  return {
    definition,
    newQuestions: Array.isArray(raw["newQuestions"]) ? raw["newQuestions"] : [],
    issues: parseIssues(raw["issues"]),
    warnings: parseIssues(raw["warnings"]),
    ...(createdBy.length === 0 ? {} : { createdBy }),
    ...(typeof acceptToken === "string" && acceptToken !== "" ? { acceptToken } : {}),
  };
}

function toCreatedBy(
  raw: unknown,
): readonly { readonly questionId: string; readonly step: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isKeyedObject(entry)) return [];
    const questionId = entry["questionId"];
    const step = entry["step"];
    if (typeof questionId !== "string" || questionId === "") return [];
    return Number.isInteger(step) ? [{ questionId, step: step as number }] : [];
  });
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
  const workspaces = toWorkspaceNames(raw["workspaces"]);
  const title = raw["title"];
  const thenAnother = raw["thenAnother"];
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
    ...(workspaces.length === 0 ? {} : { workspaces }),
    ...(typeof title === "string" && title.trim() !== "" ? { title: title.trim() } : {}),
    ...(thenAnother === true ? { thenAnother: true } : {}),
  };
}

function toWorkspaceNames(raw: unknown): readonly AgentWorkspaceName[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isKeyedObject(entry)) return [];
    const workspaceId = entry["workspaceId"];
    const name = entry["name"];
    if (typeof workspaceId !== "string" || workspaceId === "") return [];
    return typeof name === "string" && name !== "" ? [{ workspaceId, name }] : [];
  });
}
