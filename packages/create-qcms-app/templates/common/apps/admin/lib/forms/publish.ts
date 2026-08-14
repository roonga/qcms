import type { DraftForm } from "./types.ts";

/**
 * What a publish freezes, counted for the confirmation dialog (task 034).
 *
 * The dialog's job is to make R1 concrete before the author commits to it: a published
 * version is immutable, sessions pin the version they started on, and the next edit starts
 * a new draft. Three counts do that better than a sentence, because they are the author's
 * own work read back to them - if the pin count is not what they expect, the dialog has
 * caught a mistake that publish would otherwise have frozen forever.
 *
 * Counted from the draft on screen rather than from the last saved one, for the same
 * reason the preview compiles the on-screen draft: the summary has to describe what
 * pressing Publish will actually freeze.
 */
export interface FreezeSummary {
  readonly steps: number;
  /** Distinct pinned questions. A question cannot be pinned twice in one form (004). */
  readonly pins: number;
  readonly rules: number;
}

/** Count the steps, distinct pins and rules a publish would freeze. */
export function freezeSummary(draft: DraftForm | null): FreezeSummary {
  if (draft === null) return { steps: 0, pins: 0, rules: 0 };
  const pinned = new Set<string>();
  for (const step of draft.steps) {
    for (const pin of step.items) pinned.add(pin.questionId);
  }
  return { steps: draft.steps.length, pins: pinned.size, rules: draft.rules.length };
}

/** The version a publish would create, given the versions already published. */
export function nextVersion(latestVersion: number | undefined): number {
  return (latestVersion ?? 0) + 1;
}
