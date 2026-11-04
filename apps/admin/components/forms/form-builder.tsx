"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { AmbientSaveStatus, AutosaveFlash } from "@/components/save-model";
import { recordDraftSaved, usePublishBuilderAssist } from "@/lib/agent/builder-assist-bridge";
import { AUTOSAVE_DEBOUNCE_MS, useDraftAutosave } from "@/lib/forms/autosave";
import type { SaveDraftState, SettingsState, ValidateDraftState } from "@/lib/forms/builder-state";
import {
  addGroup,
  addPinAt,
  addPinToGroup,
  addStep,
  blankDraft,
  findGroup,
  moveGroupWithinStep,
  movePin,
  movePinWithinGroup,
  movePinWithinStep,
  moveStep,
  removeGroup,
  removePin,
  removeStep,
  renameGroup,
  renameStep,
  setGroupCount,
  setGroupInstanceLabel,
  setGroupPresentation,
} from "@/lib/forms/draft";
import { ruleAnchorId, rulesHref, stepAnchorId, stepIssueCounts } from "@/lib/forms/issues";
import { currentScreenName } from "@/lib/forms/screen-name";
import { hasSettingsChange, settingsPatch } from "@/lib/forms/settings";
import {
  isDraftGroup,
  type DraftForm,
  type FormDetail,
  type FormSettings,
  type PinnableQuestion,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { AgentProvenanceTag } from "./agent-provenance-tag";
import { FormSettingsPanel } from "./form-settings-panel";
import { GroupPanel } from "./group-panel";
import { RulesLens } from "./rules-lens";
import { SaveNotices } from "./save-notices";
import { concurrentNoticeCookie } from "@/lib/builder-notice";

import { usePublishBuilderRail, type BuilderSelection } from "@/lib/forms/builder-bridge";
import { StepEditor } from "./step-editor";
import { ValidationPanel } from "./validation-panel";

/* The builder owns settings and draft state because changing panels unmounts their controls mid-debounce. */

export function FormBuilder({
  detail,
  library,
  formActions,
  formMeta,
  concurrentNoticeRead,
  saveDraft,
  validateDraft,
  updateSettings,
  assist,
}: {
  readonly detail: FormDetail;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /* Pass the server-rendered action node through props; the client builder cannot bind or import its server
     implementation. */
  readonly formActions: ReactNode;
  readonly formMeta: ReactNode;
  readonly concurrentNoticeRead: boolean;
  readonly saveDraft: (
    draft: DraftForm,
    agentAssisted?: boolean,
    newQuestions?: readonly unknown[],
  ) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly updateSettings: (patch: {
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  }) => Promise<SettingsState>;
  readonly assist?: { readonly endpoint: string; readonly canPropose?: boolean };
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  const [storedSettings, setStoredSettings] = useState<FormSettings>(detail.settings);
  const [settings, setSettings] = useState<FormSettings>(detail.settings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<BuilderSelection>({ kind: "form" });
  const [agentAssisted, setAgentAssisted] = useState(detail.draftAgentAssisted);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | undefined>(
    detail.draftUpdatedAt ?? undefined,
  );

  // Consume the agent-assisted marker for one accepted save only; later ordinary edits must not inherit it.
  const pendingAgentAssisted = useRef(false);

  // Clear proposed questions only after a successful atomic accept; a refusal must retry them with the draft
  // to avoid dangling pins.
  const pendingNewQuestions = useRef<readonly unknown[]>([]);

  // No validation result is undefined, not an empty issue list; an initial value must not fabricate an
  // all-clear.
  const autosave = useDraftAutosave({
    draft,
    saveDraft: (next) => {
      const agentAssistedSave = pendingAgentAssisted.current;
      pendingAgentAssisted.current = false;
      const newQuestions = pendingNewQuestions.current;
      return saveDraft(
        next,
        agentAssistedSave || newQuestions.length > 0 ? true : undefined,
        newQuestions,
      );
    },
    validateDraft,
    onSaved: (saved) => {
      pendingNewQuestions.current = [];
      recordDraftSaved(saved.updatedAt);
      if (saved.agentAssisted !== undefined) setAgentAssisted(saved.agentAssisted);
      if (saved.updatedAt !== undefined && saved.updatedAt !== "") {
        setDraftUpdatedAt(saved.updatedAt);
      }
    },
  });
  const { issues, warnings, status, lastSavedAt, saveError, paused } = autosave;

  // Hold revalidated action props in refs so a save-triggered refresh cannot rearm autosave forever.
  const settingsAction = useRef(updateSettings);
  settingsAction.current = updateSettings;

  const mutate = (next: DraftForm) => {
    autosave.markDirty();
    setDraft(next);
  };

  function addGroupToStep(stepId: string, label: string) {
    const next = addGroup(draft, stepId, label);
    mutate(next);
    const added = next.steps.find((step) => step.stepId === stepId)?.items.at(-1);
    if (added !== undefined && isDraftGroup(added)) {
      setSelection({ kind: "group", stepId, groupId: added.groupId });
    }
  }

  const screenName = currentScreenName(selection, draft.steps);

  // Compare against confirmed settings; after a save catches up, the empty patch must not schedule another
  // save.
  useEffect(() => {
    const patch = settingsPatch(storedSettings, settings);
    if (!hasSettingsChange(patch)) return undefined;
    setSettingsSaving(true);
    const timer = setTimeout(() => {
      void (async () => {
        const result = await settingsAction.current.call(null, patch);
        setSettingsSaving(false);
        if (result.status === "error") {
          // Leave confirmed settings unchanged on failure so the patch survives and displayed edits do not snap
          // back.
          setSettingsError(result.message);
          return;
        }
        setSettingsError(undefined);
        setStoredSettings(result.settings ?? { ...storedSettings, ...patch });
        autosave.markSavedAt(new Date().toISOString());
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settings, storedSettings]);

  useEffect(() => {
    // Replace the legacy first-load address rather than keeping a history entry that never represented a
    // screen.
    const hash = window.location.hash;
    const rulePrefix = `#${ruleAnchorId("")}`;
    if (hash === "#rules") {
      window.location.replace(rulesHref(draft.formId));
      return;
    }
    if (hash.startsWith(rulePrefix)) {
      window.location.replace(`${rulesHref(draft.formId)}${hash}`);
      return;
    }

    const prefix = `#${stepAnchorId("")}`;
    if (!hash.startsWith(prefix)) return;
    const stepId = hash.slice(prefix.length);
    if (!draft.steps.some((step) => step.stepId === stepId)) return;
    setSelection({ kind: "step", stepId });
  }, []);

  const selectedStep =
    selection.kind === "step"
      ? draft.steps.find((step) => step.stepId === selection.stepId)
      : undefined;
  // A missing selected group renders no panel; silently falling back would show a different subject than
  // requested.
  const selectedGroup =
    selection.kind === "group" ? findGroup(draft, selection.groupId) : undefined;
  const selectedGroupStep =
    selectedGroup === undefined
      ? undefined
      : draft.steps.find((step) => step.stepId === selectedGroup.stepId);
  const counts = stepIssueCounts(issues ?? [], draft);

  // Memoize the bridge value: a fresh identity would notify every subscriber on every editor keystroke.
  usePublishBuilderRail(
    useMemo(
      () => ({
        draft,
        issueCounts: counts,
        selection,
        chooseForm: () => {
          setSelection({ kind: "form" });
        },
        choose: (stepId: string) => {
          setSelection({ kind: "step", stepId });
        },
        add: (title: string) => {
          const next = addStep(draft, title);
          mutate(next);
          const added = next.steps[next.steps.length - 1];
          if (added !== undefined) setSelection({ kind: "step", stepId: added.stepId });
        },
        rename: (stepId: string, title: string) => {
          mutate(renameStep(draft, stepId, title));
        },
        move: (stepId: string, delta: -1 | 1) => {
          mutate(moveStep(draft, stepId, delta));
        },
        remove: (stepId: string) => {
          mutate(removeStep(draft, stepId));
          if (selection.kind !== "form" && selection.stepId === stepId) {
            setSelection({ kind: "form" });
          }
        },
        chooseGroup: (stepId: string, groupId: string) => {
          setSelection({ kind: "group", stepId, groupId });
        },
        addGroup: (stepId: string, label: string) => {
          addGroupToStep(stepId, label);
        },
        renameGroup: (groupId: string, label: string) => {
          mutate(renameGroup(draft, groupId, label));
        },
        moveGroup: (stepId: string, groupId: string, delta: -1 | 1) => {
          mutate(moveGroupWithinStep(draft, stepId, groupId, delta));
        },
        removeGroup: (groupId: string) => {
          mutate(removeGroup(draft, groupId));
          if (selection.kind === "group" && selection.groupId === groupId) {
            setSelection({ kind: "step", stepId: selection.stepId });
          }
        },
      }),
      [draft, counts, selection, mutate],
    ),
  );

  /* Reconcile selection after replacing a draft so a deleted selected step cannot leave a blank column. */
  usePublishBuilderAssist(
    assist === undefined
      ? undefined
      : {
          endpoint: assist.endpoint,
          canPropose: assist.canPropose !== false,
          draft,
          draftUpdatedAt,
          accept: acceptAssistProposal,
        },
  );

  function acceptAssistProposal(proposedDraft: DraftForm, newQuestions: readonly unknown[]) {
    pendingAgentAssisted.current = true;
    pendingNewQuestions.current = newQuestions;
    if (
      selection.kind === "step" &&
      !proposedDraft.steps.some((step) => step.stepId === selection.stepId)
    ) {
      setSelection({ kind: "form" });
    }
    mutate(proposedDraft);
  }

  return (
    <div className="flex flex-col gap-6">
      <SaveNotices paused={paused} saveError={saveError} />

      {agentAssisted && (
        <div data-testid="qcms-builder-provenance">
          <AgentProvenanceTag />
        </div>
      )}

      {selection.kind === "form" && (
        <>
          {/* Wrap the server-rendered node: crossing the client boundary removes React's static-child marker and
   otherwise produces a keyless child. */}
          {/* The wrapper gives the server node a list position without introducing an empty flex item and its gap. */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="contents">
              <h1 className="qcms-visually-hidden">{screenName}</h1>
            </div>
            <div>{formActions}</div>
            <div className="flex flex-col items-end gap-1">
              <div>{formMeta}</div>
              <AmbientSaveStatus
                isSaving={status === "saving" || settingsSaving}
                hasFailed={saveError !== undefined || settingsError !== undefined}
                savedAt={lastSavedAt}
              />
            </div>
          </div>
          <FormNotices detail={detail} concurrentRead={concurrentNoticeRead} />
          <TextField
            label={t("forms.builder.formTitle")}
            description={t("forms.builder.formTitleHint")}
            value={textOf(draft.title, draft.defaultLocale)}
            onChange={(next) => {
              mutate({ ...draft, title: { ...draft.title, [draft.defaultLocale]: next } });
            }}
          />

          <RulesLens draft={draft} library={library} issues={issues ?? []} />

          <ValidationPanel draft={draft} issues={issues} warnings={warnings} status={status} />

          <FormSettingsPanel
            settings={settings}
            challengeEnforceable={detail.challengeEnforceable}
            saveError={settingsError}
            onChange={setSettings}
          />
        </>
      )}
      {selection.kind === "step" && (
        <div>
          {selectedStep === undefined ? null : (
            <StepEditor
              draft={draft}
              step={selectedStep}
              saveFlash={<AutosaveFlash savedAt={lastSavedAt} />}
              library={library}
              issues={issues}
              /* Fold the entire pin batch through one draft mutation; separate calls would reuse the same closed-over
                 draft and lose earlier inserts. */
              onAddPins={(pins, index, groupId) => {
                mutate(
                  pins.reduce(
                    (next, pin, offset) =>
                      groupId === undefined
                        ? addPinAt(
                            next,
                            selectedStep.stepId,
                            pin.questionId,
                            pin.version,
                            index + offset,
                          )
                        : addPinToGroup(next, groupId, pin.questionId, pin.version, index + offset),
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
              onReorderPin={(questionId, delta, groupId) => {
                mutate(
                  groupId === undefined
                    ? movePinWithinStep(draft, selectedStep.stepId, questionId, delta)
                    : movePinWithinGroup(draft, groupId, questionId, delta),
                );
              }}
              onAddGroup={(label) => {
                addGroupToStep(selectedStep.stepId, label);
              }}
              onOpenGroup={(groupId) => {
                setSelection({ kind: "group", stepId: selectedStep.stepId, groupId });
              }}
              onMoveGroup={(groupId, delta) => {
                mutate(moveGroupWithinStep(draft, selectedStep.stepId, groupId, delta));
              }}
              onRemoveGroup={(groupId) => {
                mutate(removeGroup(draft, groupId));
              }}
            />
          )}
        </div>
      )}
      {selection.kind === "group" && (
        <div>
          {selectedGroup === undefined || selectedGroupStep === undefined ? null : (
            <GroupPanel
              draft={draft}
              step={selectedGroupStep}
              group={selectedGroup.group}
              library={library}
              issues={issues}
              saveFlash={<AutosaveFlash savedAt={lastSavedAt} />}
              onRename={(label) => {
                mutate(renameGroup(draft, selectedGroup.group.groupId, label));
              }}
              onInstanceLabel={(template) => {
                mutate(setGroupInstanceLabel(draft, selectedGroup.group.groupId, template));
              }}
              onCount={(count) => {
                mutate(setGroupCount(draft, selectedGroup.group.groupId, count));
              }}
              onPresentation={(presentation) => {
                mutate(setGroupPresentation(draft, selectedGroup.group.groupId, presentation));
              }}
              onAddPins={(pins, index) => {
                mutate(
                  pins.reduce(
                    (next, pin, offset) =>
                      addPinToGroup(
                        next,
                        selectedGroup.group.groupId,
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
                mutate(movePinWithinGroup(draft, selectedGroup.group.groupId, questionId, delta));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FormNotices({
  detail,
  concurrentRead,
}: {
  readonly detail: FormDetail;
  readonly concurrentRead: boolean;
}) {
  const [dismissed, setDismissed] = useState(concurrentRead);
  const seeded = detail.draftSource === "seeded";
  const closed = detail.status === "closed";
  if (!seeded && !closed && dismissed) return null;

  return (
    <div className="flex flex-col gap-2">
      {seeded && <Alert variant="info">{t("forms.builder.seeded")}</Alert>}
      {closed && <Alert variant="info">{t("forms.builder.closed")}</Alert>}
      {!dismissed && (
        <ConcurrentNotice
          onDismiss={() => {
            setDismissed(true);
          }}
        />
      )}
    </div>
  );
}

function ConcurrentNotice({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <Alert variant="info">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span>{t("forms.builder.concurrent")}</span>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            try {
              document.cookie = concurrentNoticeCookie(window.location.protocol === "https:");
            } catch {
              // A blocked preference cookie must not prevent dismissal for this visit.
            }
            onDismiss();
          }}
        >
          {t("forms.builder.concurrentDismiss")}
        </Button>
      </div>
    </Alert>
  );
}
