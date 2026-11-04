import type { ActionResultTurn, AgentStepState, ScalarField } from "./plan-state";

/**
 * One conversation's state, with no React and no browser in it.
 *
 * The conversation is the app's, not a screen's: it follows the operator from screen to
 * screen and a reload restores it. What a turn carries about the screen is rebuilt by the
 * API for the screen the turn was sent from, so the history here is the dialogue alone -
 * the prose each side wrote and each settled card's own report. No screen's facts are in
 * it, which is why carrying it to another screen tells the model nothing about the screen
 * it left.
 */

export interface AgentProseTurn {
  /** `result` is the builder panel's own record of a card's outcome, never a model turn. */
  readonly role: "user" | "assistant" | "result";
  readonly content: string;
}

/**
 * One confirmed card's report (section 5.3). The admin writes it from the card's
 * own fold and each kind's result allowlist, so it carries no model text, no content and
 * no secret, and the API renders it to the model from these fields rather than from prose.
 */
export type AgentTurnRecord = AgentProseTurn | ActionResultTurn;

export function isProseTurn(turn: AgentTurnRecord): turn is AgentProseTurn {
  return turn.role !== "action-result";
}

/**
 * The history a turn replays: the prose without the panel's own outcome lines, and every
 * `action-result` turn as the structured record it is.
 */
export type PromptTurn =
  | { readonly role: "user" | "assistant"; readonly content: string }
  | ActionResultTurn;

export function promptTurns(turns: readonly AgentTurnRecord[]): readonly PromptTurn[] {
  return turns.flatMap((turn): readonly PromptTurn[] => {
    if (!isProseTurn(turn)) return [turn];
    return turn.role === "result" ? [] : [{ role: turn.role, content: turn.content }];
  });
}

/** The longest history the API will accept, so the oldest turns drop here rather than there. */
export const CONVERSATION_TURN_CAP = 40;

export interface ConversationState {
  /** Random, minted when the conversation starts; the key audited reads are grouped by. */
  readonly id: string;
  /**
   * The conversation's current stay on one subject. A new one is minted each time the
   * conversation arrives at a subject, so an audited read is recorded once per stay and
   * again when the conversation comes back.
   */
  readonly visitId: string;
  /** The subject {@link visitId} was minted for. */
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  /** How many of the oldest turns the cap has dropped, which the panel says once. */
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

/**
 * Where the conversation is kept between page loads.
 *
 * `sessionStorage` rather than `localStorage`: the conversation belongs to one tab's
 * stay, and nothing about it should outlive the tab or reach a second one. The entry
 * carries the user it belongs to and is discarded when that does not match the signed-in
 * user, because signing out does not clear tab storage on its own and a shared
 * workstation would otherwise hand the next person the last person's conversation. The
 * sign-out control clears it outright.
 */
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
 * Every field is checked rather than trusted: tab storage is writable by whoever holds the
 * tab, and a turn that reaches a request is validated again by the BFF route and by the
 * API. An entry with anything unreadable in it is dropped whole rather than repaired.
 */
export function parseConversation(raw: string | null, user: string): ConversationState | undefined {
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed["user"] !== user || user === "") return undefined;
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
  if ((role === "user" || role === "assistant" || role === "result") && typeof content === "string") {
    return { role, content };
  }
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
