"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { AmbientSaveStatus } from "@/components/save-model";
import type {
  PreviewConditionState,
  SaveDraftState,
  SettingsState,
  ValidateDraftState,
} from "@/lib/forms/builder-state";
import {
  addPinAt,
  addRule,
  addStep,
  blankDraft,
  movePin,
  movePinWithinStep,
  moveStep,
  removePin,
  removeRule,
  removeStep,
  renameStep,
  unsaveableReason,
  updateRule,
  type UnsaveableReason,
} from "@/lib/forms/draft";
import { issuesForRule, stepIssueCounts } from "@/lib/forms/issues";
import type {
  DraftForm,
  DraftRule,
  FormDetail,
  FormIssue,
  PinnableQuestion,
} from "@/lib/forms/types";
import { t, type MessageKey } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { ConditionEditor } from "./condition-editor";
import { FormSettingsPanel } from "./form-settings-panel";
import { RuleTestBench } from "./rule-test-bench";
import { StepEditor } from "./step-editor";
import { StepsRail } from "./steps-rail";
import { ValidationPanel, type BuilderStatus } from "./validation-panel";

/**
 * The form builder (task 033; screen contract `admin-form-builder.md`).
 *
 * ## One state owner
 *
 * This component holds the working draft and nothing below it does. Every child is
 * presentational: it takes a `value` and calls back, and the mutation itself is one of the
 * pure helpers in `lib/forms/draft.ts`. That is what keeps "what is on screen" a single
 * value rather than a set of copies that have to be kept in step, and it is why the JSON
 * pane and the condition pickers cannot disagree: they edit the same node through the same
 * callback.
 *
 * ## Autosave is advisory (022)
 *
 * A draft with issues saves perfectly well and comes back with the list of what would block
 * a publish, so the panel showing twelve issues beside "Saved 12:03" is the normal case
 * rather than a contradiction. Two states cannot be saved at all, because `FormDefinition`
 * requires at least one step and at least one pin per step: those pause autosave and say
 * why, instead of throwing a red error every few seconds while the first step is being
 * built.
 *
 * ## Why the round trip is two calls
 *
 * `PUT .../draft` stores and returns issues; `POST .../draft/validate` re-runs the same
 * compile without storing. The builder does both on one debounce because they answer
 * different questions and the second is the one exit criterion 2 turns on: the kernel's
 * `analyzeRuleGraph` runs inside that compile, so `RULE_BACKWARD_TARGET` arrives from the
 * engine itself rather than from a second implementation of the analysis in this app (there
 * could not be one - the admin has no `@qcms/core` import at all). The *instant* flag an
 * author sees the moment they pick a backward target is a different mechanism entirely:
 * `eligibleTargets`, pure draft geometry, inside the condition editor.
 *
 * ## The actions arrive as props
 *
 * A `"use client"` module may not import `lib/server/`, so the page binds each action to
 * this route's form id and passes it down. The form id therefore comes from the route
 * rather than from anything the client can edit.
 *
 * ## The library is a `ReadState`, and it stays one all the way down (issues 572, 544)
 *
 * `library` used to arrive as `ok ? data : []`, which is the collapse issue 544 filed: a
 * library that could not be read became indistinguishable from a library with nothing in
 * it. The builder passes the `ReadState` (`lib/read-state.ts`) on unchanged to the step
 * editor, the rules section and the test bench rather than unwrapping it here, so no part
 * of this tree can quietly reintroduce the empty-array fallback for its own convenience,
 * and each part decides for itself what a failure means to it. Two of them find that it
 * means nothing new (an unknown question type is an unknown question type however it came
 * to be unknown); the step editor and the picker find that it means two statements about
 * the library have to stand down. The draft, and everything that edits it, is untouched:
 * it came from a read that succeeded.
 */

/** How long the builder waits after the last keystroke before it talks to the API. */
const AUTOSAVE_DEBOUNCE_MS = 600;

export function FormBuilder({
  detail,
  library,
  saveDraft,
  validateDraft,
  updateSettings,
  previewCondition,
}: {
  readonly detail: FormDetail;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly updateSettings: (patch: {
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  }) => Promise<SettingsState>;
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  // `undefined`, not `[]`. Nothing has validated this draft when the screen opens, and a
  // seeded empty list is an initial value that the panel and the pin grid used to render
  // as a verdict: "No issues. Everything here would pass a publish." beside the Publish
  // button, on a form whose stored draft may be full of them (issue 625). The effect below
  // does not fire until the author changes something, so this stays `undefined` for as long
  // as the screen genuinely knows nothing, and the surfaces that read it say so.
  const [issues, setIssues] = useState<readonly FormIssue[] | undefined>(undefined);
  const [status, setStatus] = useState<BuilderStatus>("idle");
  // An ISO instant, not a formatted clock time. The strip renders it through the app's one
  // timestamp formatter (`plan/admin-design-contracts.md` §2: date, HH:MM, zone, no
  // seconds) and exposes the raw instant as `data-saved-at`, so the sentence a person hears
  // can be low-churn while a test can still tell two saves apart. Issue 518.
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(
    detail.draft?.steps[0]?.stepId,
  );

  // Whether the author has touched anything this visit. Without it the first render would
  // post the draft straight back, which would store a `seeded` draft nobody edited.
  const isDirty = useRef(false);
  const mutate = (next: DraftForm) => {
    isDirty.current = true;
    setDraft(next);
  };

  // The two actions live in a ref, and that is not a style choice. They arrive already
  // bound to this route's form id, so the page hands down a NEW function identity on every
  // server render - and a successful save calls `revalidatePath`, which causes one. An
  // effect that depended on them would therefore re-arm its debounce because it had just
  // saved, save again, revalidate again, and never stop. Reading them through a ref keeps
  // the effect's inputs what they actually are: the draft, and whether it can be stored.
  const actions = useRef({ saveDraft, validateDraft });
  actions.current = { saveDraft, validateDraft };

  const paused = unsaveableReason(draft);

  useEffect(() => {
    if (!isDirty.current || paused !== undefined) return undefined;
    setStatus("saving");
    const timer = setTimeout(() => {
      void (async () => {
        const saved = await actions.current.saveDraft(draft);
        if (saved.status === "error") {
          // The verdict is left exactly as it was, which on a first save means still
          // absent. `saved.issues` is the empty list a failed read supplies, and writing
          // it here would turn a store failure into a fabricated all-clear one layer
          // below the panel - the same trap the validate leg avoids below (issue 625).
          setSaveError(saved.message);
          setStatus("error");
          return;
        }
        setIssues(saved.issues);
        setSaveError(undefined);
        setLastSavedAt(new Date().toISOString());
        setStatus("validating");
        // The second round trip is the one the screen contract calls live validation. It does not
        // store, and it is where `RULE_BACKWARD_TARGET` and `RULE_CYCLE` come from: the
        // kernel's `analyzeRuleGraph` runs inside the same compile.
        const validated = await actions.current.validateDraft(draft);
        if (validated.status === "error") {
          // Keep whatever the store leg just returned rather than overwriting it with the
          // empty list a failed read supplies. `PUT .../draft` returns issues too, so the
          // number on screen is a real one computed moments ago; replacing it with zero
          // would turn a refresh failure into a fabricated all-clear. The panel says the
          // count could not be refreshed, which is only honest if there is still a count.
          setStatus("error");
          return;
        }
        setIssues(validated.issues);
        setStatus("saved");
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, paused]);

  const selectedStep = draft.steps.find((step) => step.stepId === selectedStepId) ?? draft.steps[0];
  // The step rail badges a step only when its count is ABOVE zero, so it has no all-clear
  // to fabricate: with no verdict it renders no badges and asserts nothing, which is the
  // same silence §7's form-subtree rail keeps on the other seven screens when a dry run
  // could not be had (`lib/server/form-rail.ts`). Collapsing the absence to an empty list
  // here is therefore safe, and it is the only place in this file where that is true.
  const counts = stepIssueCounts(issues ?? [], draft);

  return (
    <div className="flex flex-col gap-6">
      {/* Ambient save chrome: persistent, first thing on the screen, and the only place
          this screen states how it saves (design-language element 7; issue 518). It is
          rendered here rather than in the app shell because exactly one screen in this app
          autosaves, and a strip in the shell would have to be suppressed on the other
          fifteen - `plan/admin-design-contracts.md` §6's "exactly one save statement per
          screen" is easier to hold when the statement belongs to the screen that means it.
          `hasFailed` reads `saveError` rather than `status`, because a failed VALIDATE
          round trip also sets `status` to "error" and that is not a save failure: the
          draft is stored before the validate call is made, so this strip goes on saying
          "Saved" through one, truthfully. The failed check is stated by the validation
          panel instead, which is where the count it could not refresh already lives. */}
      <AmbientSaveStatus
        isSaving={status === "saving"}
        hasFailed={saveError !== undefined}
        savedAt={lastSavedAt}
      />
      <BuilderNotices detail={detail} paused={paused} saveError={saveError} />

      {/* 033 stood a disabled Publish button here with a note saying publishing was
          task 034's. It is, and it landed: the real control lives in `FormActions`
          above this component, where a refused publish can render its anchored work
          list beside the rules it points at. */}
      <TextField
        label={t("forms.builder.formTitle")}
        description={t("forms.builder.formTitleHint")}
        value={textOf(draft.title, draft.defaultLocale)}
        onChange={(next) => {
          mutate({ ...draft, title: { ...draft.title, [draft.defaultLocale]: next } });
        }}
      />

      {/* The three grids below are the builder's only responsive behaviour, and they
          do NOT all turn at the same width. `plan/admin-design-contracts.md` §1
          fixes two boundaries and sorts side-by-side layouts between them, and these
          three fall on both sides of that sort. Both tokens are defined in
          `app/globals.css`; `compact:` and `sidebar:` are their utility prefixes.

          THIS grid is the form's steps beside the step editor, and it keys to
          `--bp-sidebar`. §7 defines the rail as carrying the form's children, its
          steps with their per-step issue badges, so `StepsRail` is that rail, and
          §1's "panes stack rather than shrink" clause carves out the case where the
          panes are the rail itself. The render says the same thing the contract
          does: the first track is a fixed 18rem, so splitting at the compact
          boundary leaves the editor 288px, narrower than the 342px the same editor
          gets stacked on a 390px phone, and its button labels wrap. Satisfying the
          clause's letter while contradicting the reason it gives is the signal that
          the wrong boundary was picked. (Ruled on PR 576 by applying §1 and §7, not
          by deciding anything new. Issue 559 builds the real rail component and may
          replace this grid outright; until it does, this is the boundary the
          contract names for it.)

          The two grids below it are page content and key to `--bp-compact`: rules
          beside the validation panel, form settings beside the rule bench. §7 says
          the rail never carries same-page section switches and that validation stays
          on the builder page, so none of those four panes is rail content and the
          carve-out does not reach them. They are ordinary side-by-side panes, which
          §1 assigns to the compact boundary.

          All three read `md:` until issue 557, so all three broke at Tailwind's
          default 48rem, a third boundary the contract does not have. The two compact
          grids therefore split at 640 now instead of 768, which is the one
          deliberate behaviour change here: between those widths they sit side by
          side where they used to stack. `minmax(0, 1fr)` is what keeps the narrower
          track from overflowing at the new low end. */}
      <div className="grid gap-4 sidebar:grid-cols-[18rem_minmax(0,1fr)]">
        <StepsRail
          draft={draft}
          issueCounts={counts}
          selectedStepId={selectedStep?.stepId}
          onSelect={setSelectedStepId}
          onAdd={(title) => {
            const next = addStep(draft, title);
            mutate(next);
            setSelectedStepId(next.steps[next.steps.length - 1]?.stepId);
          }}
          onRename={(stepId, title) => {
            mutate(renameStep(draft, stepId, title));
          }}
          onMove={(stepId, delta) => {
            mutate(moveStep(draft, stepId, delta));
          }}
          onRemove={(stepId) => {
            mutate(removeStep(draft, stepId));
          }}
        />

        {/* Nothing rather than a second copy of the rail's own empty-state sentence: a
            step editor with no step is exactly the state the rail is already explaining,
            and saying it twice reads as two different facts. */}
        {selectedStep === undefined ? null : (
          <StepEditor
            draft={draft}
            step={selectedStep}
            library={library}
            issues={issues}
            /* One `mutate` for the whole batch, folded left over the pins.
               `addPinAt` is pure and returns the next draft, so the fold is what makes a
               multi-pin add correct: calling this handler once per pin would hand
               `addPinAt` the SAME closed-over `draft` every time and keep only the last
               result. Folding also makes the batch one entry in the draft's history, which
               is what it is to the author: one press of one button.
               The boundary advances with each pin so the batch lands in the order it was
               chosen, rather than every pin insetting at `index` and arriving reversed. */
            onAddPins={(pins, index) => {
              mutate(
                pins.reduce(
                  (next, pin, offset) =>
                    addPinAt(
                      next,
                      selectedStep.stepId,
                      pin.questionId,
                      pin.version,
                      index + offset,
                    ),
                  draft,
                ),
              );
            }}
            onMovePin={(questionId, version) => {
              mutate(movePin(draft, questionId, version));
            }}
            onRemovePin={(questionId) => {
              mutate(removePin(draft, questionId));
            }}
            onReorderPin={(questionId, delta) => {
              mutate(movePinWithinStep(draft, selectedStep.stepId, questionId, delta));
            }}
          />
        )}
      </div>

      <div className="grid gap-4 compact:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Same reasoning as the step counts above: a rule renders its issue list only
            when there is something in it, so an absent verdict and an empty one both come
            out as no list rather than as an all-clear about the rule. */}
        <RulesSection draft={draft} library={library} issues={issues ?? []} onChange={mutate} />
        <ValidationPanel draft={draft} issues={issues} status={status} />
      </div>

      <div className="grid gap-4 compact:grid-cols-2">
        <FormSettingsPanel
          settings={detail.settings}
          challengeProvider={detail.challengeProvider}
          updateSettings={updateSettings}
        />
        <RuleTestBench
          draft={draft}
          rules={draft.rules}
          library={library}
          previewCondition={previewCondition}
        />
      </div>
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

/** The standing notices: where this draft came from, and what autosave is doing. */
function BuilderNotices({
  detail,
  paused,
  saveError,
}: {
  readonly detail: FormDetail;
  readonly paused: UnsaveableReason | undefined;
  readonly saveError: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      {detail.draftSource === "seeded" && <Alert variant="info">{t("forms.builder.seeded")}</Alert>}
      {detail.status === "closed" && <Alert variant="info">{t("forms.builder.closed")}</Alert>}
      <Alert variant="info">{t("forms.builder.concurrent")}</Alert>
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

/** Every rule of the draft, plus the control that adds one. */
function RulesSection({
  draft,
  library,
  issues,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly onChange: (next: DraftForm) => void;
}) {
  // A condition has to read a question, so there is nothing to add a rule against until
  // the form pins one. The button says why rather than being silently inert.
  const firstPinned = draft.steps.flatMap((step) => step.items)[0]?.questionId;

  return (
    <section
      aria-labelledby="qcms-rules-heading"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="qcms-rules-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.rules.title")}
        </h2>
        <Button
          variant="secondary"
          size="md"
          isDisabled={firstPinned === undefined}
          onPress={() => {
            if (firstPinned !== undefined) onChange(addRule(draft, firstPinned));
          }}
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
        <div className="flex flex-col gap-4">
          {draft.rules.map((rule) => (
            <ConditionEditor
              key={rule.ruleId}
              draft={draft}
              rule={rule}
              library={library}
              issues={issuesForRule(issues, rule.ruleId)}
              onChange={(next: DraftRule) => {
                onChange(updateRule(draft, rule.ruleId, next));
              }}
              onRemove={() => {
                onChange(removeRule(draft, rule.ruleId));
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
