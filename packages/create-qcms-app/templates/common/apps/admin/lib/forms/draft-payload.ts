import {
  REPEAT_PRESENTATIONS,
  type DraftGroup,
  type DraftPin,
  type DraftRepeatCount,
  type DraftRule,
  type DraftStep,
  type DraftStepItem,
} from "./types.ts";
import type { LocalizedText } from "../questions/types.ts";

// Share this tolerant reader across stored drafts, proposal diffs and accepts so groups cannot vanish on one path. Only the kernel decides legality; unreadable count sources must not be invented.

function isKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objects(raw: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isKeyedObject) : [];
}

// Check localized map values individually; unvalidated numeric titles must not reach the UI.
export function readLocalizedText(raw: unknown): LocalizedText {
  if (!isKeyedObject(raw)) return {};
  const text: Record<string, string> = {};
  for (const [locale, value] of Object.entries(raw)) {
    if (typeof value === "string") text[locale] = value;
  }
  return text;
}

function strings(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readPin(record: Record<string, unknown>): DraftPin | undefined {
  if (typeof record["questionId"] !== "string" || typeof record["version"] !== "number") {
    return undefined;
  }
  return { questionId: record["questionId"], version: record["version"] };
}

function readPins(raw: unknown): readonly DraftPin[] {
  return objects(raw)
    .map(readPin)
    .filter((pin): pin is DraftPin => pin !== undefined);
}

// Do not invent an unreadable count source: a fallback would show and autosave a group size the author never chose.
export function readRepeatCount(raw: unknown): DraftRepeatCount | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const max = typeof raw["max"] === "number" ? { max: raw["max"] } : {};
  if (raw["source"] === "fixed" && typeof raw["count"] === "number") {
    return { source: "fixed", count: raw["count"] };
  }
  if (typeof raw["min"] !== "number") return undefined;
  if (raw["source"] === "open") return { source: "open", min: raw["min"], ...max };
  if (raw["source"] === "fromAnswer" && typeof raw["questionId"] === "string") {
    return { source: "fromAnswer", questionId: raw["questionId"], min: raw["min"], ...max };
  }
  return undefined;
}

function readGroup(record: Record<string, unknown>): DraftGroup | undefined {
  const count = readRepeatCount(record["count"]);
  if (count === undefined) return undefined;
  const presentation = REPEAT_PRESENTATIONS.find(
    (candidate) => candidate === record["presentation"],
  );
  return {
    groupId: record["groupId"] as string,
    label: readLocalizedText(record["label"]),
    instanceLabel: readLocalizedText(record["instanceLabel"]),
    items: readPins(record["items"]),
    count,

    presentation: presentation ?? "stacked",
  };
}

// A malformed claimed group must not fall through as a question pin.
export function readStepItems(raw: unknown): readonly DraftStepItem[] {
  const items: DraftStepItem[] = [];
  for (const record of objects(raw)) {
    if (typeof record["groupId"] === "string") {
      const group = readGroup(record);
      if (group !== undefined) items.push(group);
      continue;
    }
    const pin = readPin(record);
    if (pin !== undefined) items.push(pin);
  }
  return items;
}

export function readDraftSteps(raw: unknown): readonly DraftStep[] {
  return objects(raw)
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({
      stepId: entry["stepId"] as string,
      title: readLocalizedText(entry["title"]),
      items: readStepItems(entry["items"]),
    }));
}

// Preserve unfamiliar condition operators so the editor can expose them instead of silently dropping authored logic.
export function readDraftRules(raw: unknown): readonly DraftRule[] {
  return objects(raw)
    .filter((entry) => typeof entry["ruleId"] === "string" && isKeyedObject(entry["when"]))
    .map((entry) => ({
      ruleId: entry["ruleId"] as string,
      when: entry["when"] as DraftRule["when"],
      show: strings(entry["show"]),
    }));
}
