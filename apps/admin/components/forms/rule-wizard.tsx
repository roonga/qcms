"use client";

import { useId, useState } from "react";

import { Button, Dialog, Tab, TabList, TabPanel, Tabs } from "@/components/kit";
import { conditionReferences } from "@/lib/forms/condition";
import { upsertRule } from "@/lib/forms/draft";
import { issuesForRule, messageForIssue } from "@/lib/forms/issues";
import type { PreviewConditionState } from "@/lib/forms/builder-state";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

import { ConditionEditor } from "./condition-editor";
import { RuleTargets } from "./rule-targets";
import { RuleTestBench } from "./rule-test-bench";

/**
 * The rule editor: three phases in one wide dialog (Code Owner, 2026-08-30).
 *
 * ## What it replaced, and what the complaint was
 *
 * A single pane in a `max-w-md` modal holding a nested boolean tree, a JSON mirror and a
 * flat wrap of every target the form has. Two things were wrong with it and they are
 * different problems. It was NARROW: a condition tree beside its targets does not fit in
 * 28rem, and `condition-editor.tsx` had already been given `qcms-scroll-x` so that the
 * page would not scroll sideways when it did not. And it was UNDIFFERENTIATED: choosing
 * what a rule reads, choosing what it shows, and checking what it would do are three
 * separate questions with three separate controls, stacked as one column.
 *
 * ## TABS, not a stepper, and the reason is that nothing here is gated
 *
 * A stepper promises sequence: finish this, then the next opens. This wizard has no such
 * invariant to enforce. `eligibleTargets` recomputes from the condition on every render,
 * so the target list is correct the instant it is looked at whatever order the author
 * worked in; the bench posts whatever the dialog is currently holding. An author editing
 * an existing rule usually wants only its targets, and a stepper would make them walk
 * past a condition they did not come to change.
 *
 * Three further reasons, all of them about what a reader is told:
 *
 * - `role="tablist"` is a named ARIA pattern, so a screen reader already announces
 *   "tab, 2 of 3, selected" and the panel's relationship to it. A stepper has no role of
 *   its own; it would need `aria-current` plus hand-written position text, which is
 *   reinventing an announcement that exists.
 * - Tabs carry a roving tabindex, so the phase control is ONE tab stop with arrow keys
 *   inside it. Three buttons plus Back and Next would put five stops between the dialog's
 *   title and the first control an author came here to use.
 * - The labels are numbered ("1. When", "2. Then show", "3. Test") because the phases do
 *   have a natural order and stating it costs nothing. Numbering describes; a stepper
 *   would enforce. The Code Owner asked for the first.
 *
 * **Focus between phases** is the tabs pattern's own: selecting a tab leaves focus on the
 * tab, and Tab from there enters the panel. That is what APG specifies and what a reader
 * who navigates by arrow keys expects; moving focus into the panel on selection would make
 * arrow-key browsing of the three phases impossible, because the first arrow press would
 * already have left the tablist.
 *
 * **Focus on Save and Cancel** is the modal's: react-aria returns focus to whatever had it
 * when the dialog opened, which is the row's Edit button or the Add rule button. Neither
 * disappears on either exit, so nothing is lost, and the author is back on the control
 * that took them here rather than at the top of the document.
 *
 * ## It BUFFERS, and that is the whole of the Cancel promise
 *
 * `plan/admin-design-contracts.md` §6, amendment of 2026-08-30. The rule lives in this
 * component's state while the dialog is open and reaches the draft only when Save is
 * pressed, so Cancel genuinely discards rather than closing a workspace whose every
 * keystroke has already landed. That is a deliberate exception to this screen's autosave
 * model, and the amendment records what it costs: while the dialog is open the screen's
 * autosave has nothing to save, so a long edit is unsaved work.
 *
 * The buffer is also what makes an ADD honest. "Add rule" hands this component a rule that
 * has been MINTED but not added (`newRule`), and Save is what adds it, so cancelling out of
 * a rule you have just started leaves nothing behind. Committing it on open would leave a
 * targetless rule that `unsaveableReason` reads as an unsaveable draft, and the pressed
 * Cancel would then pause the whole screen's autosave instead of discarding anything.
 *
 * ## The dialog's own save model is stated beside its own control
 *
 * §6's 2026-08-21 amendment: a nested scope that persists states its own model where its
 * control is. This is one - it has its own commit, and the screen's ambient strip cannot
 * speak for it - so the footer carries the sentence, with the longer explanation behind a
 * `?` rather than as a standing paragraph. `public-form-link.tsx` is the pattern.
 *
 * ## Removal is not here
 *
 * The table row owns Remove, and `rules-table.tsx` explains why its two commands are on
 * the surface rather than one press away. A second Remove inside a buffering dialog would
 * have to answer "does Cancel put it back", and there is no answer to that which is not a
 * surprise to somebody.
 */
export function RuleWizard({
  draft,
  rule,
  library,
  issues,
  previewCondition,
  onSave,
  onCancel,
}: {
  /** The stored draft. The buffered rule is folded into it for the target list and bench. */
  readonly draft: DraftForm;
  /** The rule as it stood when the dialog opened: an existing one, or a freshly minted one. */
  readonly rule: DraftRule;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
  readonly onSave: (rule: DraftRule) => void;
  readonly onCancel: () => void;
}) {
  // THE BUFFER. Seeded from the prop once, by `useState`'s initial value, and never
  // synchronised back to it: a prop that overwrote this on every parent render would be
  // the autosave model wearing a Save button.
  const [edited, setEdited] = useState<DraftRule>(rule);
  const [phase, setPhase] = useState<Phase>("when");
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);

  // Computed once and shared by the three phases, so the target grouping, the backward
  // flag and the bench cannot disagree about what this condition reads.
  const references = conditionReferences(edited.when);
  // The draft AS THE AUTHOR HAS IT, which is what the target geometry and the bench are
  // questions about. Without this the "Then show" list would be grouped against the stored
  // condition and the bench would preview a rule the author has already changed.
  const working = upsertRule(draft, edited);
  const ruleIssues = issuesForRule(issues, edited.ruleId);

  return (
    <Dialog
      isOpen
      title={t("forms.rules.editTitle", { ruleId: edited.ruleId })}
      // NOT DISMISSABLE BY THE BACKDROP. A click outside would discard buffered work with
      // no press and no question, which is the one failure an explicit Cancel exists to
      // rule out. Escape still closes, because a modal that cannot be escaped is a trap,
      // and it is routed through the same Cancel that the button is.
      isDismissable={false}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onCancel();
      }}
    >
      {/* The identity the specs and the backward flag address a rule by. `ruleAnchorId` is
          deliberately NOT here: the anchor a validation entry links to is the table row,
          which exists whether or not anyone is editing (`rules-table.tsx`), and a second
          element carrying the same id while the dialog is open would make that link
          ambiguous. */}
      <section
        className="qcms-rule-wizard"
        data-rule-id={edited.ruleId}
        data-qcms-dialog="wide"
        aria-label={t("forms.rule.heading", { ruleId: edited.ruleId })}
      >
        <Tabs
          selectedKey={phase}
          onSelectionChange={(key) => {
            setPhase(key as Phase);
          }}
          className="qcms-rule-wizard__tabs"
        >
          <TabList aria-label={t("forms.rules.phases")} className="qcms-phasetabs">
            <Tab id="when" className="qcms-phasetab">
              {t("forms.rules.phaseWhen")}
            </Tab>
            <Tab id="then" className="qcms-phasetab">
              {t("forms.rules.phaseThen")}
            </Tab>
            <Tab id="test" className="qcms-phasetab">
              {t("forms.rules.phaseTest")}
            </Tab>
          </TabList>

          <TabPanel id="when" className="qcms-rule-wizard__panel">
            <ConditionEditor draft={working} rule={edited} library={library} onChange={setEdited} />
          </TabPanel>

          <TabPanel id="then" className="qcms-rule-wizard__panel">
            <RuleTargets
              draft={working}
              rule={edited}
              references={references}
              onChange={(show) => {
                setEdited((current) => ({ ...current, show }));
              }}
            />
          </TabPanel>

          <TabPanel id="test" className="qcms-rule-wizard__panel">
            {/* THE BENCH FOR THIS RULE, against the draft this dialog is holding. It took
                the whole form's rules and offered a picker; the rule is already chosen by
                the time anyone reaches this phase. */}
            <RuleTestBench
              draft={working}
              rule={edited}
              library={library}
              previewCondition={previewCondition}
            />
          </TabPanel>
        </Tabs>

        {/* THE ENGINE'S FINDINGS ABOUT THIS RULE, outside the phases rather than inside
            one of them. An issue is reported against the RULE - `issuesForRule` keys by
            `ruleId`, not by field - so hiding it behind whichever tab happened to be
            selected would let an author work on the targets while the reason the rule is
            refused sits on a panel they are not looking at.

            THEY ARE THE VERDICT ON THE STORED RULE, and while this dialog is open that is
            the last SAVED one. Buffering is why: nothing typed here reaches the draft, so
            nothing revalidates until Save. The instant statements an author needs mid-edit
            are the ones this dialog can compute for itself - the backward-target flag on
            the targets phase, from pure draft geometry - and the kernel's own verdict
            arrives on the next debounce after Save, at this same rule. */}
        {ruleIssues.length > 0 && (
          <ul aria-label={t("forms.rule.issues")} className="flex flex-col gap-1">
            {ruleIssues.map((issue, index) => (
              <li
                key={`${issue.code}:${String(index)}`}
                className="text-sm text-(--color-danger-fg)"
                data-issue-code={issue.code}
              >
                {messageForIssue(issue)}
              </li>
            ))}
          </ul>
        )}

        {/* THE FOOTER, outside the scrolling panel above it. `plan/admin-design-contracts.md`
            §5's one button order: the primary action first, Cancel last, anchored to the
            start of the row. The save-model sentence follows them and its `?` follows that,
            so the row's controls are before anything that can change size - the trap
            `components/save-model.tsx` records, where a disclosure inside an end-anchored
            row moves the control out from under the pointer. The paragraph renders under
            the row, not in it. */}
        <div className="qcms-rule-wizard__footer">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onPress={() => {
                onSave(edited);
              }}
            >
              {t("forms.rules.save")}
            </Button>
            <Button variant="secondary" size="md" onPress={onCancel}>
              {t("forms.rules.cancel")}
            </Button>
            <span className="text-sm text-(--color-text-muted)">{t("forms.rules.saveModel")}</span>
            <button
              type="button"
              className="qcms-help-dot"
              aria-expanded={helpOpen}
              aria-controls={helpId}
              aria-label={t("forms.rules.saveModelHelpLabel")}
              onClick={() => {
                setHelpOpen((open) => !open);
              }}
            >
              <span aria-hidden="true">{"?"}</span>
            </button>
          </div>
          {helpOpen && (
            <p id={helpId} className="text-sm text-(--color-text-muted)">
              {t("forms.rules.saveModelDetail")}
            </p>
          )}
        </div>
      </section>
    </Dialog>
  );
}

/** The three phases, in the order the labels number them. */
type Phase = "when" | "then" | "test";
