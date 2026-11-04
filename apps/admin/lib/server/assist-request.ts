/** Action results are untrusted relay shapes. Permit only scalars; the API revalidates kind-specific allowlists before using them as model context. */
/** Allow only IDs, turn text and typed filters; extra fields could smuggle context content into the API request. */

export interface AssistTurnRelay {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type AssistResultFields = Readonly<Record<string, string | number | boolean>>;

export interface AssistActionResultRelay {
  readonly role: "action-result";
  readonly proposalId: string;
  readonly steps: readonly {
    readonly kind: string;
    readonly outcome: string;
    readonly result?: AssistResultFields;
  }[];
}

export type AssistConversationRelay = AssistTurnRelay | AssistActionResultRelay;

const OUTCOMES: readonly string[] = [
  "done",
  "failed",
  "pending-approval",
  "not-run",
  "cancelled",
  "expired",
];

function parseResultFields(raw: unknown): AssistResultFields | undefined {
  if (!isRecord(raw)) return undefined;
  const fields: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[name] = value;
    }
  }
  return Object.keys(fields).length === 0 ? undefined : fields;
}

function parseActionResult(entry: Record<string, unknown>): AssistActionResultRelay | undefined {
  const { proposalId, steps } = entry;
  if (typeof proposalId !== "string" || proposalId === "" || !Array.isArray(steps)) {
    return undefined;
  }
  const parsed: AssistActionResultRelay["steps"][number][] = [];
  for (const step of steps) {
    if (!isRecord(step)) return undefined;
    const { kind, outcome } = step;
    if (typeof kind !== "string" || kind === "") return undefined;
    if (typeof outcome !== "string" || !OUTCOMES.includes(outcome)) return undefined;
    const result = parseResultFields(step["result"]);
    parsed.push({ kind, outcome, ...(result === undefined ? {} : { result }) });
  }
  return parsed.length === 0 ? undefined : { role: "action-result", proposalId, steps: parsed };
}

export interface AssistFiltersRelay {
  readonly version?: number;
  readonly from?: string;
  readonly to?: string;
  readonly flagged?: boolean;
}

export interface AssistParamsRelay {
  readonly formId?: string;
  readonly questionId?: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly version?: number;
  readonly filters?: AssistFiltersRelay;
}

export function parseAssistConversation(raw: unknown): readonly AssistConversationRelay[] {
  if (!Array.isArray(raw)) return [];
  const turns: AssistConversationRelay[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { role, content } = entry;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      turns.push({ role, content });
      continue;
    }
    if (role !== "action-result") continue;
    const settled = parseActionResult(entry);
    if (settled !== undefined) turns.push(settled);
  }
  return turns;
}

const ID_KEYS = ["formId", "questionId", "workspaceId", "sessionId"] as const;

export function parseAssistParams(raw: unknown): AssistParamsRelay | undefined {
  if (!isRecord(raw)) return undefined;
  const params: Record<string, unknown> = {};
  for (const key of ID_KEYS) {
    const value = raw[key];
    if (typeof value === "string") params[key] = value;
  }
  if (typeof raw["version"] === "number") params["version"] = raw["version"];
  const filters = parseAssistFilters(raw["filters"]);
  if (filters !== undefined) params["filters"] = filters;
  return params;
}

function parseAssistFilters(raw: unknown): AssistFiltersRelay | undefined {
  if (!isRecord(raw)) return undefined;
  const filters: Record<string, unknown> = {};
  if (typeof raw["version"] === "number") filters["version"] = raw["version"];
  if (typeof raw["from"] === "string") filters["from"] = raw["from"];
  if (typeof raw["to"] === "string") filters["to"] = raw["to"];
  if (typeof raw["flagged"] === "boolean") filters["flagged"] = raw["flagged"];
  return Object.keys(filters).length === 0 ? undefined : filters;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
