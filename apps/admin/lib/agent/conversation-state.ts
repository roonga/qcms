import type { ActionResultTurn, AgentStepState, ScalarField } from "./plan-state";

/** One conversation's state, with no React and no browser in it. */

export interface AgentProseTurn {
  /** `result` is the builder panel's own record of a card's outcome, never a model turn. */
  readonly role: "user" | "assistant" | "result";
  readonly content: string;
}

/** Action-result turns are built from the card fold and registered result allowlists, never model prose, content or secrets. */
export type AgentTurnRecord = AgentProseTurn | ActionResultTurn;

export function isProseTurn(turn: AgentTurnRecord): turn is AgentProseTurn {
  return turn.role !== "action-result";
}

/**
 * A card on screen that the person has not acted on. Derived from the live card each time
 * a turn is sent rather than kept in the history, because a card stops waiting without
 * writing anything: it is confirmed, cancelled, expired or replaced by the next one.
 */
export interface WaitingProposalTurn {
  readonly role: "proposal";
  readonly proposalId: string;
  readonly steps: readonly { readonly kind: string }[];
}

export type PromptTurn =
  | { readonly role: "user" | "assistant"; readonly content: string }
  | ActionResultTurn
  | WaitingProposalTurn;

/** The history a turn replays: the prose without the panel's own outcome lines. */
export function promptTurns(turns: readonly AgentTurnRecord[]): readonly PromptTurn[] {
  return turns.flatMap((turn): readonly PromptTurn[] => {
    if (!isProseTurn(turn)) return [turn];
    return turn.role === "result" ? [] : [{ role: turn.role, content: turn.content }];
  });
}

/** Step kinds alone: what the card covers is in the model's own words, already in the history. */
export function waitingProposalTurns(
  waiting:
    | { readonly proposalId: string; readonly steps: readonly { readonly kind: string }[] }
    | undefined,
): readonly WaitingProposalTurn[] {
  if (waiting === undefined || waiting.steps.length === 0) return [];
  return [
    {
      role: "proposal",
      proposalId: waiting.proposalId,
      steps: waiting.steps.map((step) => ({ kind: step.kind })),
    },
  ];
}

/** The longest history the API accepts, so the oldest turns drop here rather than there. */
export const CONVERSATION_TURN_CAP = 40;

export interface ConversationState {
  /** Random, minted when the conversation starts; the key audited reads are grouped by. */
  readonly id: string;
  /** The current stay on {@link subject}: a new one each time the conversation returns. */
  readonly visitId: string;
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  /** How many of the oldest turns the cap has dropped. */
  readonly dropped: number;
}

export function startConversation(subject: string, mint: () => string): ConversationState {
  return { id: mint(), visitId: mint(), subject, turns: [], dropped: 0 };
}

/** The history with these turns on the end, the oldest dropped once it is over the cap. */
export function appendCapped(
  state: ConversationState,
  turns: readonly AgentTurnRecord[],
): ConversationState {
  const all = [...state.turns, ...turns];
  const over = Math.max(0, all.length - CONVERSATION_TURN_CAP);
  if (over === 0) return { ...state, turns: all };
  return { ...state, turns: all.slice(over), dropped: state.dropped + over };
}

/** The state as it stands on a subject: a new stay whenever the subject is a new one. */
export function atSubject(
  state: ConversationState,
  subject: string,
  mint: () => string,
): ConversationState {
  if (state.subject === subject) return state;
  return { ...state, subject, visitId: mint() };
}

/** Tab-scoped, so no conversation outlives the tab or reaches a second one. */
export const CONVERSATION_STORAGE_KEY = "qcms-assistant-conversation";

interface StoredConversation extends ConversationState {
  readonly user: string;
}

export function serializeConversation(state: ConversationState, user: string): string {
  const stored: StoredConversation = { ...state, user };
  return JSON.stringify(stored);
}

/**
 * The conversation an entry holds, or `undefined` when there is none this user may have.
 *
 * Tab storage is writable by whoever holds the tab, so nothing in an entry is trusted and
 * an entry with one unreadable field is dropped whole.
 */
export function parseConversation(raw: string | null, user: string): ConversationState | undefined {
  if (raw === null || user === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["user"] !== user) return undefined;
  const id = asNonEmpty(parsed["id"]);
  const visitId = asNonEmpty(parsed["visitId"]);
  const subject = asNonEmpty(parsed["subject"]);
  const dropped = parsed["dropped"];
  if (id === undefined || visitId === undefined || subject === undefined) return undefined;
  if (typeof dropped !== "number" || !Number.isInteger(dropped) || dropped < 0) return undefined;
  const turns = parseTurns(parsed["turns"]);
  if (turns === undefined) return undefined;
  return { id, visitId, subject, dropped, turns };
}

const OUTCOMES: readonly AgentStepState[] = [
  "proposed",
  "running",
  "done",
  "failed",
  "pending-approval",
  "not-run",
  "cancelled",
  "expired",
];

function asOutcome(raw: unknown): AgentStepState | undefined {
  return OUTCOMES.find((outcome) => outcome === raw);
}

function parseTurns(raw: unknown): readonly AgentTurnRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const turns: AgentTurnRecord[] = [];
  for (const entry of raw) {
    const turn = parseTurn(entry);
    if (turn === undefined) return undefined;
    turns.push(turn);
  }
  return turns.length > CONVERSATION_TURN_CAP ? turns.slice(-CONVERSATION_TURN_CAP) : turns;
}

function parseTurn(raw: unknown): AgentTurnRecord | undefined {
  if (!isRecord(raw)) return undefined;
  const role = raw["role"];
  const content = raw["content"];
  const prose = role === "user" || role === "assistant" || role === "result";
  if (prose && typeof content === "string") return { role, content };
  if (role !== "action-result") return undefined;
  const proposalId = asNonEmpty(raw["proposalId"]);
  const steps = raw["steps"];
  if (proposalId === undefined || !Array.isArray(steps)) return undefined;
  const parsed: ActionResultTurn["steps"][number][] = [];
  for (const step of steps) {
    if (!isRecord(step)) return undefined;
    const kind = asNonEmpty(step["kind"]);
    const outcome = asOutcome(step["outcome"]);
    if (kind === undefined || outcome === undefined) return undefined;
    const result = parseResult(step["result"]);
    parsed.push({ kind, outcome, ...(result === undefined ? {} : { result }) });
  }
  return { role: "action-result", proposalId, steps: parsed };
}

/** Scalars only, as the card's own fold writes them. */
function parseResult(raw: unknown): Readonly<Record<string, ScalarField>> | undefined {
  if (!isRecord(raw)) return undefined;
  const fields: Record<string, ScalarField> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[name] = value;
    }
  }
  return Object.keys(fields).length === 0 ? undefined : fields;
}

function asNonEmpty(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
