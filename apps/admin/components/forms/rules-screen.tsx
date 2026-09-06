"use client";

import { useEffect, useState } from "react";

import { AmbientSaveStatus } from "@/components/save-model";
import { useDraftAutosave } from "@/lib/forms/autosave";
import type { PreviewConditionState, SaveDraftState } from "@/lib/forms/builder-state";
import type { ValidateDraftState } from "@/lib/forms/builder-state";
import { blankDraft } from "@/lib/forms/draft";
import { ruleAnchorId } from "@/lib/forms/issues";
import type { DraftForm, FormDetail, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";

import { RulesEditor } from "./rules-editor";
import { SaveNotices } from "./save-notices";

/**
 * The rules screen: `/forms/{formId}/rules` (Code Owner, 2026-09-05, issue #669).
 *
 * ## One state owner, one save model
 *
 * This component holds the working draft while a reader is on this route, exactly the way
 * `FormBuilder` holds it on `/forms/{formId}`, and it stores it through the same hook
 * (`lib/forms/autosave.ts`). That is deliberate rather than convenient: two screens editing
 * one document through two save loops would be two save models with one name, which is what
 * `plan/admin-design-contracts.md` §6 spent two amendments closing inside the builder.
 * `lib/save-model.test.ts` inventories both routes as `autosave` and requires both to reach
 * the loop through the one module.
 *
 * WHAT IT COSTS, stated rather than discovered: the two routes hold two copies of the draft
 * and each stores the whole document, so a navigation between them re-reads from the API
 * and the last save wins. That is this app's concurrency model already - there is no
 * locking, and `forms.builder.concurrent` says so on the builder - and a route boundary is
 * a page load, so there is no window in which one screen's stale copy overwrites the
 * other's without the reader having gone there.
 *
 * ## No rail bridge, on purpose
 *
 * `lib/forms/builder-bridge.ts` is how the builder hands its draft to the rail beside it, so
 * a step row can select a step in the editor. Nothing here publishes to it, and the rail on
 * this route therefore renders the server's anchors: rows that NAVIGATE to
 * `/forms/{formId}#step-{stepId}`. That is correct rather than a limitation - there is no
 * step editor on this screen to select into, and a row that looked interactive and changed
 * nothing would be the worse outcome.
 *
 * ## Validation is not here, and that is the other half of the ruling
 *
 * Issue #659 kept the validation panel a builder SELECTION (built as #719), because its
 * entries move focus to controls the builder itself renders and the refused-publish list
 * reuses the same component verbatim. Rules went the other way. So the two halves of one
 * POC screen use different mechanisms, which is deliberate and priced - see
 * `plan/admin-design-contracts.md` §7. What crosses the boundary is the rule-scoped issue
 * link, and it crosses it as a route plus a fragment ({@link ruleAnchorId} is the fragment;
 * `lib/forms/issues.ts`'s `ruleHref` composes it), which this screen honours on arrival.
 */
export function RulesScreen({
  detail,
  library,
  verdict,
  saveDraft,
  validateDraft,
  previewCondition,
}: {
  readonly detail: FormDetail;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /**
   * The engine's verdict on the STORED draft, from the server's own dry run, or
   * `undefined` when that read failed.
   *
   * WHY THIS SCREEN OPENS WITH ONE AND THE BUILDER DOES NOT (issue #669). This route is
   * where every rule-scoped issue link lands - the validation panel's and the refused
   * publish's alike - so a reader arrives here BECAUSE something is wrong with a rule. A
   * table that tagged nothing until the reader happened to edit something would have lost
   * exactly the behaviour the ruling required the move to keep. `lib/server/form-verdict.ts`
   * holds the reasoning and the per-request memo that makes it free.
   */
  readonly verdict?: {
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  };
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  const autosave = useDraftAutosave({
    draft,
    saveDraft,
    validateDraft,
    ...(verdict === undefined ? {} : { initialVerdict: verdict }),
  });

  const mutate = (next: DraftForm): void => {
    autosave.markDirty();
    setDraft(next);
  };

  // THE RULE THE READER WAS SENT TO, when they arrived carrying one.
  //
  // This is the arrival half of the ruling's mandatory constraint. A rule-scoped issue
  // link, a lens line and the publish rejection's work list all address a rule as
  // `/forms/{formId}/rules#rule-{ruleId}`, and a fragment naming an element that the server
  // rendered before hydration is one the browser may or may not have scrolled to and has
  // certainly not FOCUSED. Focusing it is the whole point of a jump: the audit's objection
  // was never about scroll position, it was that "activating one moves focus to the target
  // control" would stop being true across a route boundary.
  //
  // Mount only, and bounded. The row exists as soon as this component renders, so one frame
  // is normally enough; three attempts is the same budget the validation panel's own
  // `focusWhenRendered` uses, and giving up is the honest outcome when a link names a rule
  // this draft no longer has.
  useEffect(() => {
    const prefix = `#${ruleAnchorId("")}`;
    const hash = window.location.hash;
    if (!hash.startsWith(prefix)) return;
    focusWhenRendered(hash.slice(1));
    // Deliberately empty: this is about the ARRIVAL, not about every later draft change.
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SaveNotices paused={autosave.paused} saveError={autosave.saveError} />

      {/* ONE SAVE STATEMENT, at the top of the screen that stores. §6 gives a screen
          holding accumulated authored state exactly one statement of when that state was
          stored, and this route holds the draft while a rule is being edited. Without it
          an author editing a condition would be reading the builder's strip - one route
          away, describing a copy of the draft this screen is not saving. */}
      <div className="flex justify-end">
        <AmbientSaveStatus
          isSaving={autosave.status === "saving"}
          hasFailed={autosave.saveError !== undefined}
          savedAt={autosave.lastSavedAt}
        />
      </div>

      <RulesEditor
        draft={draft}
        library={library}
        issues={autosave.issues ?? []}
        previewCondition={previewCondition}
        onChange={mutate}
      />
    </div>
  );
}

/**
 * Scroll a destination into view and put focus on it, retrying a bounded number of frames.
 *
 * Deliberately dumber than it could be, for the reason `components/forms/validation-panel.tsx`
 * gives about its twin: the alternative is threading a "focus this once you have rendered"
 * value through another seam, and three frames is enough for a first paint.
 */
function focusWhenRendered(anchor: string, attemptsLeft = 3): void {
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (target !== null) {
      target.scrollIntoView({ block: "nearest" });
      target.focus();
      return;
    }
    if (attemptsLeft > 0) focusWhenRendered(anchor, attemptsLeft - 1);
  });
}
