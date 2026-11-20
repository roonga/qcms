import type { PreviewView } from "./preview-views.ts";
import type { DraftForm } from "./types.ts";

export type PreviewRailState = "completed" | "current" | "ahead" | "notNeeded";

export interface PreviewRailStep {
  readonly stepId: string;
  readonly label: string;
  readonly state: PreviewRailState;
  /** The view a completed step's row opens. */
  readonly cursor: number | null;
}

/**
 * The portal's step rail for the view the preview shows. The preview pages freely, so its
 * resume point is the shown view and every step behind it reads as completed.
 */
export function previewRail(
  draft: DraftForm,
  views: readonly PreviewView[],
  shownIndex: number,
): PreviewRailStep[] {
  const current = views[shownIndex]?.step.stepId;
  return draft.steps.map((step) => {
    const base = { stepId: step.stepId, label: step.title[draft.defaultLocale] ?? "" };
    const first = views.findIndex((view) => view.step.stepId === step.stepId);
    if (first < 0) return { ...base, state: "notNeeded", cursor: null };
    if (step.stepId === current) return { ...base, state: "current", cursor: null };
    if (first < shownIndex) return { ...base, state: "completed", cursor: first };
    return { ...base, state: "ahead", cursor: null };
  });
}
