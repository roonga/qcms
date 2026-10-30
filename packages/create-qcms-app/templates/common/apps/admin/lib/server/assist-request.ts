/**
 * What the two assist routes trust out of a turn's body.
 *
 * One parser for both, so the per-form route and the screen route forward the same shapes:
 * a turn's role and prose, route ids, and the response list's four filters. Anything else
 * is dropped rather than relayed, because what the API accepts is what it will build a
 * context from.
 */

export interface AssistTurnRelay {
  readonly role: "user" | "assistant";
  readonly content: string;
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

/** Every turn whose shape these routes trust enough to forward; anything else is dropped. */
export function parseAssistConversation(raw: unknown): readonly AssistTurnRelay[] {
  if (!Array.isArray(raw)) return [];
  const turns: AssistTurnRelay[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      turns.push({ role, content });
    }
  }
  return turns;
}

const ID_KEYS = ["formId", "questionId", "workspaceId", "sessionId"] as const;

/** Route ids, and the filters as their own strictly-typed object. */
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
  return params as AssistParamsRelay;
}

function parseAssistFilters(raw: unknown): AssistFiltersRelay | undefined {
  if (!isRecord(raw)) return undefined;
  const filters: Record<string, unknown> = {};
  if (typeof raw["version"] === "number") filters["version"] = raw["version"];
  if (typeof raw["from"] === "string") filters["from"] = raw["from"];
  if (typeof raw["to"] === "string") filters["to"] = raw["to"];
  if (typeof raw["flagged"] === "boolean") filters["flagged"] = raw["flagged"];
  return Object.keys(filters).length === 0 ? undefined : (filters as AssistFiltersRelay);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
