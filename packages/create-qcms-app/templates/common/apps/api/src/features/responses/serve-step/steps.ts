import type { FlowState, InstanceId, StepId } from "@roonga/qcms-core";

export const RAIL_STATES = ["completed", "current", "ahead", "notNeeded"] as const;
export type RailState = (typeof RAIL_STATES)[number];

export interface StepView {
  readonly stepId: StepId;
  readonly instanceId: InstanceId | null;
}

export function stepViewsOf(flow: FlowState): readonly StepView[] {
  const views = flow.visibleStepViews;
  if (views !== undefined) return views;
  return flow.visibleSteps.map((stepId) => ({ stepId, instanceId: null }));
}

/**
 * The last view Continue could reach: the end of the first step that still holds a missing
 * required answer, or of the first step owed a roster mint, whichever comes first. A
 * whole step rather than a view, because a step's own questions are on every one of its
 * pages, so a respondent paging through instances stays inside it.
 */
export function lastReachableView(
  flow: FlowState,
  views: readonly StepView[],
  owedSteps: ReadonlySet<StepId>,
): number {
  const blocking = flow.complete ? null : flow.currentStep;
  const first = views.findIndex((view) => view.stepId === blocking || owedSteps.has(view.stepId));
  if (first < 0) return views.length - 1;
  const stepId = views[first]?.stepId;
  let end = first;
  while (views[end + 1]?.stepId === stepId) end += 1;
  return end;
}

export interface RailEntry {
  readonly stepId: StepId;
  readonly state: RailState;
  /** The view a link to this step opens; set for a completed step only. */
  readonly cursor: number | null;
}

/**
 * Every step in form order. A completed step is one behind the rendered view, or one
 * between it and the resume point, which a back-jump leaves behind; anything else
 * visible is ahead, because Continue is the only way past the resume point.
 */
export function railEntries(input: {
  readonly steps: readonly StepId[];
  readonly views: readonly StepView[];
  /** The rendered view's index; `views.length` when no step is rendered. */
  readonly servedIndex: number;
  /** The view served with no cursor; `views.length` when nothing is left. */
  readonly resumeIndex: number;
}): RailEntry[] {
  const { steps, views, servedIndex, resumeIndex } = input;
  const current = views[servedIndex]?.stepId;
  return steps.map((stepId) => {
    const first = views.findIndex((view) => view.stepId === stepId);
    if (first < 0) return { stepId, state: "notNeeded", cursor: null };
    if (stepId === current) return { stepId, state: "current", cursor: null };
    let last = first;
    while (views[last + 1]?.stepId === stepId) last += 1;
    if (first < servedIndex || last < resumeIndex) {
      return { stepId, state: "completed", cursor: first };
    }
    return { stepId, state: "ahead", cursor: null };
  });
}
