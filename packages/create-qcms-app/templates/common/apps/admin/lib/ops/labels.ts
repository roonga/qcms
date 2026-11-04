import { textOf } from "../questions/definition.ts";
import type { QuestionDetail } from "../questions/types.ts";

/** Resolve captions through the frozen form pin, never the latest question label. Missing pinned versions fall back to IDs rather than miscaptioning historical answers. */

export interface QuestionPin {
  readonly questionId: string;
  readonly version: number;
}

/** Read pins tolerantly without kernel validation; unresolved shapes show IDs instead of breaking the audit view. Expand one group level because nested groups are forbidden. */
export function pinsOf(definition: unknown): readonly QuestionPin[] {
  const steps = (definition as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    const items = (step as { items?: unknown } | null)?.items;
    return Array.isArray(items) ? items.flatMap(pinsOfItem) : [];
  });
}

/** Read container members when items is present; this caption reader needs pins regardless of the container ID. */
function pinsOfItem(item: unknown): readonly QuestionPin[] {
  const members = (item as { items?: unknown } | null)?.items;
  if (Array.isArray(members)) return members.flatMap(asPin);
  return asPin(item);
}

function asPin(candidate: unknown): readonly QuestionPin[] {
  const pin = candidate as { questionId?: unknown; version?: unknown } | null;
  if (typeof pin?.questionId !== "string" || typeof pin.version !== "number") return [];
  return [{ questionId: pin.questionId, version: pin.version }];
}

export function labelsForPins(
  pins: readonly QuestionPin[],
  details: readonly QuestionDetail[],
): ReadonlyMap<string, string> {
  const byId = new Map(details.map((detail) => [detail.questionId, detail]));
  const labels = new Map<string, string>();
  for (const pin of pins) {
    const version = byId
      .get(pin.questionId)
      ?.versions.find((candidate) => candidate.version === pin.version);
    if (version === undefined) continue;
    const label = textOf(version.definition.label);
    if (label !== "") labels.set(pin.questionId, label);
  }
  return labels;
}

export function labelFor(labels: ReadonlyMap<string, string>, questionId: string): string {
  return labels.get(questionId) ?? questionId;
}

/** Preserve document order, then append unpinned answers in stable ID order; never hide stored answers because a definition no longer pins them. */
export function orderedAnswerKeys(
  answers: Readonly<Record<string, unknown>>,
  pins: readonly QuestionPin[],
): readonly string[] {
  const present = new Set(Object.keys(answers));
  const ordered: string[] = [];
  for (const pin of pins) {
    if (!present.has(pin.questionId)) continue;
    if (ordered.includes(pin.questionId)) continue;
    ordered.push(pin.questionId);
  }
  const rest = [...present]
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}
