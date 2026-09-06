"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/kit";
import type { PreviewConditionState } from "@/lib/forms/builder-state";
import { newRule, removeRule, upsertRule } from "@/lib/forms/draft";
import { NEW_RULE_HASH } from "@/lib/forms/issues";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";
import type { ReadState } from "@/lib/read-state";

import { RuleTestBenchPanel } from "./rule-test-bench";
import { RuleWizard } from "./rule-wizard";
import { RulesTable } from "./rules-table";

/**
 * Every rule of the draft, plus the control that adds one and the wizard that edits one.
 *
 * ## This is a route now, and it used to be a selection
 *
 * `plan/admin-shell-poc/rules-screen-poc.html` has drawn a dedicated rules screen since
 * the shell work began. It was built as a SELECTION on the builder on 2026-08-26, because
 * `plan/admin-ux-audit.md` §5.5 objected that a rules ROUTE would resolve every rule-scoped
 * validation anchor to nothing. The Code Owner ruled on 2026-09-05 (issue #669) that the
 * POC is built as drawn - `/forms/{formId}/rules` - and attached the constraint that makes
 * the split safe: every link that has to survive the move carries the route as well as the
 * fragment, and the handler switches route before it focuses. `lib/forms/issues.ts`'s
 * {@link ruleHref} is that, and `RulesScreen` is what focuses on arrival.
 *
 * The builder keeps a compact read-only lens (`components/forms/rules-lens.tsx`), which is
 * what `admin-shell-poc.html` draws in its own Rules card.
 *
 * ## The rule being edited is held BY VALUE
 *
 * The reverse of what this held before 2026-08-30, and it is the buffering directly. It
 * used to hold an id and look the rule up on every render, because the draft was replaced
 * on every keystroke inside the dialog and a held object would have gone stale immediately.
 * The dialog no longer writes to the draft at all, so the object is now the only copy there
 * is, and looking one up by id could not work for an ADD - a rule being added is not in the
 * draft to be found. `RuleWizard` seeds its own buffer from this and hands it back on Save.
 *
 * ## Two benches, and neither is the other (Code Owner, 2026-08-30)
 *
 * The screen's stays under this table, expanded, with its Select over the form's rules: it
 * answers "the form has these rules - what does that one do", which is a question asked
 * while READING the table, about rules as they are stored. The wizard's third phase is the
 * other one, about the single rule being edited and against the draft the dialog is
 * buffering, so it answers about an edit that has not been saved yet. One tests the form;
 * the other tests the change.
 */
export function RulesEditor({
  draft,
  library,
  issues,
  previewCondition,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /** The engine's verdict, or an empty list when nothing has checked this draft yet. */
  readonly issues: readonly FormIssue[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
  readonly onChange: (next: DraftForm) => void;
}) {
  // A condition has to read a question, so there is nothing to add a rule against until
  // the form pins one. The button says why rather than being silently inert.
  const firstPinned = draft.steps.flatMap((step) => step.items)[0]?.questionId;
  const [edited, setEdited] = useState<DraftRule | undefined>(undefined);

  // MINTED, NOT ADDED. The rule reaches the draft when Save is pressed and not before, so
  // cancelling out of a rule you have just started leaves nothing behind - and no targetless
  // rule is left to pause the screen's autosave (`unsaveableReason`'s third case).
  const startAdding = (): void => {
    if (firstPinned !== undefined) setEdited(newRule(draft, firstPinned));
  };

  // ARRIVING WITH "ADD A RULE" ALREADY ASKED FOR (issue #669). The builder's lens is
  // read-only, so its own Add rule is an anchor to this route carrying `#new-rule`, and
  // this is the other half of it. The same shape the rail's Add step already uses, and for
  // the same reason: off this screen there is no draft in that tree to mint a rule in.
  //
  // Cleared once read, and that is not tidiness: left in place, a reload - or a press of
  // Back onto this URL - would reopen a dialog the reader had already dismissed, with no
  // way to be rid of it short of editing the address bar.
  //
  // Mount only. `firstPinned` is read through a ref-free closure here because a form with
  // nothing pinned cannot take a rule at all, and the screen's own explanation of that is
  // already on the page.
  useEffect(() => {
    if (window.location.hash !== NEW_RULE_HASH) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    startAdding();
    // Deliberately empty: this is about the ARRIVAL, not about every later draft change.
  }, []);

  return (
    <section
      // LABELLED BY THE PAGE'S OWN `<h1>`, which `FormPageHeader` renders for this route
      // (visually hidden, because the breadcrumb directly above already ends in "Rules").
      // It used to mint its own heading, which was right while this was one of the
      // builder's three screens and the route's heading belonged to another of them. On a
      // route of its own, a second level-one heading would be the defect.
      aria-labelledby={sectionHeadingId("rules")}
      // NO BOX (Code Owner, 2026-08-29). The border and padding made sense when the rules
      // were one panel among five on the form's screen and something had to say where they
      // began. They are the whole of their own screen now, so the frame was a box drawn
      // around everything - and the table inside it already has its own edges.
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.lensNote")}</p>
        <Button
          variant="secondary"
          size="md"
          isDisabled={firstPinned === undefined}
          onPress={startAdding}
        >
          {t("forms.rules.add")}
        </Button>
      </div>

      {firstPinned === undefined && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.needPin")}</p>
      )}

      {draft.rules.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.empty")}</p>
      ) : (
        <RulesTable
          draft={draft}
          library={library}
          issues={issues}
          onEdit={(ruleId) => {
            setEdited(draft.rules.find((rule) => rule.ruleId === ruleId));
          }}
          onRemove={(ruleId) => {
            onChange(removeRule(draft, ruleId));
          }}
        />
      )}

      {/* THE SCREEN'S BENCH, EXPANDED (Code Owner, 2026-08-29, restored 2026-08-30). Under
          the rules it tests, because it reads `draft.rules` and answers "what would this
          rule do", which is a question you ask while looking at the rule. It takes the
          STORED rules: the wizard's copy is the one that sees an edit in progress. */}
      <RuleTestBenchPanel
        draft={draft}
        rules={draft.rules}
        library={library}
        previewCondition={previewCondition}
      />

      {/* THE EDITOR IS A THREE-PHASE WIZARD IN A WIDE DIALOG (Code Owner, 2026-08-30), and
          the table above is still the read view (Code Owner, 2026-08-26).

          CANCEL AND SAVE, which means this buffers: `RuleWizard` holds the rule and only
          what comes back through `onSave` reaches the draft. `plan/admin-design-contracts.md`
          §6's 2026-08-30 amendment is the ruling and states the cost - while the dialog is
          open the screen's autosave has nothing to save, so a long edit is unsaved work.

          `key` is the rule id, so opening a different rule REMOUNTS the wizard and its
          buffer is seeded afresh. Without it React would keep the state of the previous
          rule's dialog, and the second rule an author opened would be shown the first
          one's edits. */}
      {edited !== undefined && (
        <RuleWizard
          key={edited.ruleId}
          draft={draft}
          rule={edited}
          library={library}
          issues={issues}
          previewCondition={previewCondition}
          onSave={(next) => {
            onChange(upsertRule(draft, next));
            setEdited(undefined);
          }}
          onCancel={() => {
            setEdited(undefined);
          }}
        />
      )}
    </section>
  );
}
