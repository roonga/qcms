import { stepPins } from "./draft.ts";
import type { DraftForm } from "./types.ts";

// Read back step, pin and rule counts before freezing so authors can catch a missing part of the draft.
export interface FreezeSummary {
  readonly steps: number;

  readonly pins: number;
  readonly rules: number;
}

export function freezeSummary(draft: DraftForm | null): FreezeSummary {
  if (draft === null) return { steps: 0, pins: 0, rules: 0 };
  const pinned = new Set<string>();
  for (const step of draft.steps) {
    for (const pin of stepPins(step)) pinned.add(pin.questionId);
  }
  return { steps: draft.steps.length, pins: pinned.size, rules: draft.rules.length };
}

export function nextVersion(latestVersion: number | undefined): number {
  return (latestVersion ?? 0) + 1;
}
