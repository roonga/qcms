"use client";

import { Alert } from "@/components/kit";
import type { UnsaveableReason } from "@/lib/forms/draft";
import { t, type MessageKey } from "@/lib/i18n/en";

/**
 * Autosave paused, and a save that failed - on every screen that edits the draft.
 *
 * These stay above whatever the screen is showing, and that is the point rather than an
 * oversight. The form's standing facts (it was seeded, it is closed, someone else may be
 * editing it) are read once and then never again; these two are about the save happening
 * right now, and the work at risk when they appear is usually what the reader is editing.
 * Hiding "this draft is not being saved" behind a screen switch would hide it exactly when
 * it matters most. They appear rarely and clear themselves, so they cost a quiet screen
 * nothing.
 *
 * SHARED SINCE ISSUE #669, when rule editing became a route. Both drafting screens run the
 * one save loop (`lib/forms/autosave.ts`) and both therefore owe the same two sentences; a
 * second copy of this component on the rules screen would be a second vocabulary for the
 * same pause, drifting the moment either was touched.
 */
export function SaveNotices({
  paused,
  saveError,
}: {
  readonly paused: UnsaveableReason | undefined;
  readonly saveError: string | undefined;
}) {
  // NOTHING, not an empty box. A drafting screen's column is a `gap-6` flex stack, so a
  // wrapper that renders with zero height still consumes a whole gap slot: on the step
  // screen that put 48px between the breadcrumb and the step's card where 24px was
  // intended, and the empty div doing it was invisible in the picture and in the DOM
  // inspector alike.
  if (paused === undefined && saveError === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      {paused !== undefined && (
        <div data-testid="qcms-autosave-paused" data-paused-reason={paused}>
          <Alert variant="warning">{t(PAUSE_MESSAGES[paused])}</Alert>
        </div>
      )}
      {saveError !== undefined && (
        <Alert variant="error">{t("forms.builder.saveFailed", { message: saveError })}</Alert>
      )}
    </div>
  );
}

/**
 * Why autosave is paused, in the author's words.
 *
 * A table rather than a chain of ternaries so that adding a fourth unsaveable state is a
 * compile error here until it has a sentence: `Record<UnsaveableReason, MessageKey>` is
 * exhaustive by construction.
 */
const PAUSE_MESSAGES: Readonly<Record<UnsaveableReason, MessageKey>> = {
  noSteps: "forms.save.pausedNoSteps",
  emptyStep: "forms.save.pausedEmptyStep",
  ruleWithoutTarget: "forms.save.pausedNoTarget",
};
