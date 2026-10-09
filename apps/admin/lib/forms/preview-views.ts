import type { CompiledStep, PreviewFlow } from "./types";

/**
 * The preview pane's page list (task 076, ADR-28 as amended 2026-09-29, Q22).
 *
 * ## Why this exists as its own module
 *
 * The preview's job is to be the thing a respondent gets rather than a lookalike
 * (`components/forms/draft-preview.tsx` says so at length), and after this task a page is
 * a **view** rather than a step: a `perInstanceStep` group paginates one step into one
 * page per live instance, so Previous and Next have to move one view. Reading that list
 * in one pure function is what keeps the pane and the portal's cursor talking about the
 * same thing; deriving it inside the component would be a second reading of ADR-28 in a
 * second app, which is exactly the class of drift the shared `documentForVisible` and the
 * shared renderer exist to prevent.
 *
 * ## It decides nothing
 *
 * The API computed the view list (it is the kernel's `visibleStepViews`, forwarded by the
 * preview endpoint) and this pairs each entry with the compiled document it draws. When
 * the draft holds no repeating group the field is absent, and the list is `visibleSteps`
 * in document order with a null instance on every entry - the same sequence the pane
 * walked before this task, so a draft with no group previews identically.
 *
 * Order comes from `documents` for the step-shaped case, for the reason the component
 * already records: the compiled documents are emitted in the definition's step order,
 * which is the order a respondent walks them in, while a projection list is a set rather
 * than a sequence. The view list is already a sequence, so when it is present it is used
 * as given.
 *
 * ## What it deliberately stops short of
 *
 * It pairs a view with its document and no more. Narrowing the drawn group to the view's
 * instance needs a **roster**, and the preview has none until task 074 mints one locally
 * and sends it with the draft; that task owns `draft-preview.tsx`'s expansion and the
 * group panel's presentation switch beside it. Until then a draft cannot carry a group at
 * all (`DraftStep.items` is a pin list), so this list is `visibleSteps` by another name
 * and the pane previews exactly what it previewed before.
 */

/** One page of the preview walk: a compiled step, and the instance it draws if it draws one. */
export interface PreviewView {
  readonly step: CompiledStep;
  /** The instance this page draws, or `null` for an ordinary step page. */
  readonly instanceId: string | null;
}

export function previewViews(
  documents: readonly CompiledStep[],
  flow: PreviewFlow | undefined,
): readonly PreviewView[] {
  const byStep = new Map(documents.map((document) => [document.stepId, document]));
  const views = flow?.visibleStepViews;
  if (views === undefined) {
    const visible = new Set(flow?.visibleSteps ?? []);
    return documents
      .filter((document) => visible.has(document.stepId))
      .map((step) => ({ step, instanceId: null }));
  }
  // A view naming a step with no compiled document cannot happen for a draft that
  // compiled, and dropping it is the honest degradation rather than rendering a hole.
  return views.flatMap((view) => {
    const step = byStep.get(view.stepId);
    return step === undefined ? [] : [{ step, instanceId: view.instanceId }];
  });
}
