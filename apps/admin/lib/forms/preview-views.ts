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

// Use server view order as given; page instances must be narrowed against the served roster, never guessed.

export interface PreviewView {
  readonly step: CompiledStep;

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

  return views.flatMap((view) => {
    const step = byStep.get(view.stepId);
    return step === undefined ? [] : [{ step, instanceId: view.instanceId }];
  });
}

export interface PreviewViewNarrowing {
  readonly groupId: string;
  readonly instanceId: string;
}

// Do not narrow to an instance absent from the served roster.
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

// Resolve ordinals against the full roster; IDs and one-element narrowed lists cannot supply the respondent ordinal.
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
