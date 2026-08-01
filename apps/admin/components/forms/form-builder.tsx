"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import type {
  PreviewConditionState,
  SaveDraftState,
  SettingsState,
  ValidateDraftState,
} from "@/lib/forms/builder-state";
import {
  addPin,
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
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

import { ConditionEditor } from "./condition-editor";
import { FormSettingsPanel } from "./form-settings-panel";
import { RuleTestBench } from "./rule-test-bench";
import { StepEditor } from "./step-editor";
import { StepsRail } from "./steps-rail";
import { ValidationPanel, type BuilderStatus } from "./validation-panel";

/**
 * The form builder (task 033; wireframe `admin-form-builder.md`).
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
  readonly library: readonly PinnableQuestion[];
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
  const [issues, setIssues] = useState<readonly FormIssue[]>([]);
  const [status, setStatus] = useState<BuilderStatus>("idle");
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

  const paused = unsaveableReason(draft);

  useEffect(() => {
    if (!isDirty.current || paused !== undefined) return undefined;
    setStatus("saving");
    const timer = setTimeout(() => {
      void (async () => {
        const saved = await saveDraft(draft);
        setIssues(saved.issues);
        if (saved.status === "error") {
          setSaveError(saved.message);
          setStatus("error");
          return;
        }
        setSaveError(undefined);
        setLastSavedAt(new Date().toLocaleTimeString());
        setStatus("validating");
        const validated = await validateDraft(draft);
        setIssues(validated.issues);
        setStatus(validated.status === "error" ? "error" : "saved");
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // Deliberately just the draft and the pause reason. `saveDraft` and `validateDraft` are
    // bound server actions whose identity changes on every server render, so listing them
    // would re-run the debounce for a reason that is not an edit.
  }, [draft, paused, saveDraft, validateDraft]);

  const selectedStep = draft.steps.find((step) => step.stepId === selectedStepId) ?? draft.steps[0];
  const counts = stepIssueCounts(issues, draft);

  return (
    <div className="flex flex-col gap-6">
      <BuilderNotices detail={detail} paused={paused} saveError={saveError} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <TextField
          label={t("forms.builder.formTitle")}
          description={t("forms.builder.formTitleHint")}
          value={textOf(draft.title, draft.defaultLocale)}
          onChange={(next) => {
            mutate({ ...draft, title: { ...draft.title, [draft.defaultLocale]: next } });
          }}
        />
        <div className="flex flex-col gap-1">
          <Button variant="primary" size="md" isDisabled>
            {t("forms.builder.publish")}
          </Button>
          <p className="text-xs text-(--color-text-muted)">{t("forms.builder.publishNote")}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
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
            onAddPin={(questionId, version) => {
              mutate(addPin(draft, selectedStep.stepId, questionId, version));
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

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <RulesSection draft={draft} library={library} issues={issues} onChange={mutate} />
        <ValidationPanel draft={draft} issues={issues} status={status} lastSavedAt={lastSavedAt} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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
        <div data-testid="qcms-autosave-paused">
          <Alert variant="warning">
            {paused === "noSteps" ? t("forms.save.pausedNoSteps") : t("forms.save.pausedEmptyStep")}
          </Alert>
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
  readonly library: readonly PinnableQuestion[];
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
