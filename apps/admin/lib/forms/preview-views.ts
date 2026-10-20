import { instanceLabelFor } from "@roonga/qcms-ui/repeat-node";

import { textOf } from "../questions/definition.ts";
import { findGroup } from "./draft.ts";
import {
  isDraftGroup,
  type CompiledStep,
  type DraftForm,
  type DraftGroup,
  type PreviewFlow,
} from "./types.ts";

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
 * ## Narrowing a page to its instance
 *
 * `previewViews` pairs a view with its document and no more. Drawing one instance on a
 * per-instance page is {@link previewViewNarrowing}'s job, and naming that instance in the
 * pane's step line is {@link previewInstanceLabel}'s. Both mirror the portal's
 * `viewNarrowing` and `viewInstanceLabel` (`apps/portal/lib/repeat.ts`), with one
 * difference forced on the admin: the portal is TOLD the paginating group by the API's
 * `view.groupId`, while the preview endpoint forwards the kernel's view list, which names
 * only the instance. So the group is read from the draft by the kernel's own rule (the
 * FIRST `perInstanceStep` group on the step, `stepViews` in
 * `packages/core/src/evaluate-rules.ts` and `paginatingGroup` in the API's serve-step
 * handler), and the label is resolved with the renderer's own `instanceLabelFor`.
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

/** The renderer's `view` option: the one group a page paginates and the instance it draws. */
export interface PreviewViewNarrowing {
  readonly groupId: string;
  readonly instanceId: string;
}

/**
 * The narrowing a per-instance page is, or `undefined` for every ordinary page.
 *
 * Also `undefined` while the draft and the last projection disagree (the author switched
 * the group's presentation and the debounced re-ask has not answered yet): the page then
 * draws every instance for one round trip rather than guessing at a group. The same holds
 * when the instance is not in that group's served roster, so a page never narrows to an
 * instance the projection does not carry.
 */
export function previewViewNarrowing(
  draft: DraftForm | null,
  view: PreviewView | undefined,
  rosters: Readonly<Record<string, readonly string[]>>,
): PreviewViewNarrowing | undefined {
  if (draft === null || view === undefined || view.instanceId === null) return undefined;
  const { instanceId } = view;
  const step = draft.steps.find((candidate) => candidate.stepId === view.step.stepId);
  const group = step?.items.find(
    (item): item is DraftGroup => isDraftGroup(item) && item.presentation === "perInstanceStep",
  );
  if (group === undefined || !(rosters[group.groupId] ?? []).includes(instanceId)) return undefined;
  return { groupId: group.groupId, instanceId };
}

/**
 * The resolved label of the instance a per-instance page draws ("Passenger 2"), or
 * `undefined` when the page draws no instance or the template is empty.
 *
 * Resolved against the FULL served roster, so the ordinal is the instance's place in the
 * group rather than in a one-element list, and never from the `ins_` id, which is not
 * something a respondent reads (ADR-42).
 */
export function previewInstanceLabel(
  draft: DraftForm | null,
  rosters: Readonly<Record<string, readonly string[]>>,
  narrowing: PreviewViewNarrowing | undefined,
): string | undefined {
  if (draft === null || narrowing === undefined) return undefined;
  const found = findGroup(draft, narrowing.groupId);
  const index = (rosters[narrowing.groupId] ?? []).indexOf(narrowing.instanceId);
  if (found === undefined || index < 0) return undefined;
  const template = textOf(found.group.instanceLabel, draft.defaultLocale);
  return template === "" ? undefined : instanceLabelFor(template, index + 1);
}
