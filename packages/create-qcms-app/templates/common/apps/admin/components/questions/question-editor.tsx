"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, Checkbox, Select, TextField } from "@/components/kit";
import { useAppLocale } from "@/components/locale-context";
import { t } from "@/lib/i18n/en";
import {
  blankDefinition,
  forWire,
  localizedDraft,
  questionIdFromSlug,
  textOf,
} from "@/lib/questions/definition";
import {
  QUESTION_FORM_ID,
  chooseQuestionPanel,
  resetQuestionPanel,
  useQuestionPanel,
  usePublishQuestionPanels,
  usePublishQuestionSave,
} from "@/lib/questions/editor-bridge";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import {
  fieldErrorProps,
  issuesByField,
  optionalProp,
  unplacedIssues,
} from "@/lib/questions/errors";
import {
  DEFAULT_QUESTION_PANEL,
  firstPanelWithIssue,
  panelAnchorId,
  panelIssueCounts,
  questionPanels,
  renderedQuestionFields,
  type QuestionPanel,
  type QuestionPanelId,
} from "@/lib/questions/panels";
import {
  QUESTION_TYPES,
  type ChoiceOptionView,
  type ConstraintsView,
  type DefinitionIssue,
  type QuestionDefinitionView,
  type QuestionType,
  type ValidationMessagesView,
} from "@/lib/questions/types";

import { ConstraintsEditor } from "./constraints-editor";
import { BooleanLabelsEditor, MessagesEditor } from "./messages-editor";
import { OptionGridEditor } from "./option-grid-editor";

/* Use a stable empty issue list so memo dependencies do not republish the rail on every keystroke. */
const NO_ISSUES: readonly DefinitionIssue[] = [];

export function QuestionEditor({
  mode,
  action,
  initialSlug,
  initialDefinition,
  version,
  isFrozen = false,
  isDeprecated = false,
  addressedPanel,
  preview,
}: {
  readonly mode: "create" | "edit";
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly initialSlug: string;
  readonly initialDefinition: QuestionDefinitionView;
  readonly version: number;
  readonly isFrozen?: boolean;
  readonly isDeprecated?: boolean;
  readonly addressedPanel?: QuestionPanelId;
  readonly preview?: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_MUTATION);
  const [slug, setSlug] = useState(state.submitted?.slug ?? initialSlug);
  const [definition, setDefinition] = useState<QuestionDefinitionView>(
    state.submitted?.definition ?? initialDefinition,
  );
  const [saved, setSaved] = useState(state.submitted?.definition ?? initialDefinition);
  /* Capture the document at submit time, when the serialized payload is fixed, rather than reading a later
     render. */
  const submitted = useRef<QuestionDefinitionView | undefined>(undefined);
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.submitted !== undefined) {
      setSlug(state.submitted.slug);
      setDefinition(state.submitted.definition);
    }
    if (state.status === "saved") setSaved(submitted.current ?? definition);
  }

  const isCreate = mode === "create";
  const questionId = isCreate ? questionIdFromSlug(slug) : definition.questionId;
  const issueList = state.issues ?? NO_ISSUES;
  const issues = issuesByField(issueList);

  function changeType(next: QuestionType): void {
    setDefinition(blankDefinition(next, questionId));
  }

  function patch(fields: Partial<QuestionDefinitionView>): void {
    setDefinition((current) => ({ ...current, ...fields }));
  }

  const locale = useAppLocale();
  const panels = useMemo(
    () => questionPanels(definition, { withPreview: preview !== undefined, locale }),
    [definition, preview, locale],
  );
  const counts = useMemo(() => panelIssueCounts(panels, issueList), [panels, issueList]);
  const leftover = unplacedIssues(issueList, renderedQuestionFields(panels));

  // If a conditional panel disappears, fall back to Content, which always exists and is required to save.
  const chosen = useQuestionPanel(addressedPanel ?? DEFAULT_QUESTION_PANEL);
  const open = panels.some((panel) => panel.id === chosen) ? chosen : DEFAULT_QUESTION_PANEL;
  const shown = addressedPanel === undefined ? panels : panels.filter((panel) => panel.id === open);
  // Keep preview outside the form: its live controls must neither submit with the definition nor block
  // native submission.
  const editing = shown.filter((panel) => panel.id !== "preview");
  const showPreview = open === "preview" && preview !== undefined && addressedPanel !== undefined;

  usePublishQuestionPanels(useMemo(() => ({ panels, issueCounts: counts }), [panels, counts]));

  usePublishQuestionSave(
    useMemo(() => (isFrozen ? undefined : { isPending }), [isFrozen, isPending]),
  );

  useEffect(
    () => () => {
      resetQuestionPanel();
    },
    [],
  );

  // Choose the refused panel first, then focus in an effect after its controls mount.
  const [focusPanel, setFocusPanel] = useState<QuestionPanelId | undefined>(undefined);
  const summary = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const first = firstPanelWithIssue(panels, counts);
    if (first === undefined) {
      summary.current?.focus();
      return;
    }
    setFocusPanel(first);
    if (addressedPanel !== undefined) chooseQuestionPanel(first);
  }, [state]);
  useEffect(() => {
    if (focusPanel === undefined) return;
    setFocusPanel(undefined);
    const section = document.getElementById(panelAnchorId(focusPanel));
    if (section === null) return;
    (firstInvalidControl(section) ?? section).focus();
  }, [focusPanel]);

  return (
    <>
      {/* No disabled guard is needed here: the submit control lives outside this server-rendered form and mounts
   after hydration. */}
      <form
        id={QUESTION_FORM_ID}
        action={formAction}
        className="flex flex-col gap-5"
        onSubmit={() => {
          submitted.current = definition;
        }}
        // Cancel reset in capture before react-aria's target listener overwrites the controlled document with
        // mount-time values.
        onResetCapture={(event) => {
          event.preventDefault();
        }}
      >
        {isDeprecated && (
          <p className="text-sm text-(--color-warning-fg)">
            {t("questions.detail.deprecatedNote")}
          </p>
        )}
        {isFrozen && (
          <p className="text-sm text-(--color-text-muted)">{t("questions.editor.frozen")}</p>
        )}

        <input type="hidden" name="definition" value={JSON.stringify(forWire(definition))} />
        <input type="hidden" name="questionId" value={questionId} />
        <input type="hidden" name="version" value={String(version)} />
        {!isCreate && <input type="hidden" name="slug" value={slug} />}

        {state.status === "error" && (
          // Use a focusable wrapper for refusals no panel can place; tabIndex -1 makes it a destination without
          // adding a Tab stop.
          <div ref={summary} tabIndex={-1} data-testid="qcms-question-errors">
            <Alert variant="error" {...optionalProp("title", state.message)}>
              {leftover.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {leftover.map((issue) => (
                    <li key={`${issue.code}:${(issue.path ?? []).join(".")}`}>
                      {issue.path === undefined || issue.path.length === 0
                        ? issue.message
                        : `${issue.path.join(" / ")}: ${issue.message}`}
                    </li>
                  ))}
                </ul>
              )}
            </Alert>
          </div>
        )}
        {state.status === "saved" && <Alert variant="success">{t("questions.editor.saved")}</Alert>}

        {editing.map((panel) => (
          <section
            key={panel.id}
            id={panel.anchorId}
            tabIndex={-1}
            className="qcms-question-panel"
            data-question-panel={panel.id}
          >
            <PanelBody
              panel={panel}
              definition={definition}
              issues={issues}
              isFrozen={isFrozen}
              isCreate={isCreate}
              slug={slug}
              questionId={questionId}
              onSlug={(next) => {
                setSlug(next);
                patch({ questionId: questionIdFromSlug(next) });
              }}
              onType={changeType}
              onPatch={patch}
            />
          </section>
        ))}
      </form>
      {showPreview && (
        <section
          id={panelAnchorId("preview")}
          tabIndex={-1}
          className="qcms-question-panel flex flex-col gap-4"
          data-question-panel="preview"
        >
          {hasUnsavedEdits(definition, saved) && (
            <Alert variant="warning">{t("questions.preview.stale")}</Alert>
          )}
          {preview}
        </section>
      )}
    </>
  );
}

/* Compare normalized wire definitions so whitespace or a cleared constraint cannot falsely mark the
   preview stale. */
function hasUnsavedEdits(draft: QuestionDefinitionView, saved: QuestionDefinitionView): boolean {
  return JSON.stringify(forWire(draft)) !== JSON.stringify(forWire(saved));
}

interface PanelBodyProps {
  readonly panel: QuestionPanel;
  readonly definition: QuestionDefinitionView;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
  readonly isCreate: boolean;
  readonly slug: string;
  readonly questionId: string;
  readonly onSlug: (next: string) => void;
  readonly onType: (next: QuestionType) => void;
  readonly onPatch: (fields: Partial<QuestionDefinitionView>) => void;
}

function PanelBody(props: PanelBodyProps) {
  const { panel, definition, issues, isFrozen, onPatch } = props;
  switch (panel.id) {
    case "content":
      return <ContentPanel {...props} />;
    case "options":
      return (
        <OptionGridEditor
          options={definition.options ?? []}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(options: readonly ChoiceOptionView[]) => {
            onPatch({ options });
          }}
        />
      );
    case "constraints":
      return (
        <ConstraintsEditor
          type={definition.type}
          constraints={definition.constraints ?? {}}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(constraints: ConstraintsView) => {
            onPatch({ constraints });
          }}
        />
      );
    case "messages":
      return (
        <MessagesEditor
          definition={definition}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(messages: ValidationMessagesView) => {
            onPatch({ messages });
          }}
        />
      );
    case "booleanLabels":
      return (
        <BooleanLabelsEditor
          definition={definition}
          issues={issues}
          isFrozen={isFrozen}
          onChange={onPatch}
        />
      );
    // Preview returns outside the form; retain this unreachable branch to keep QUESTION_PANELS exhaustively
    // checked.
    case "preview":
      return null;
  }
}

function ContentPanel({
  panel,
  definition,
  issues,
  isFrozen,
  isCreate,
  slug,
  questionId,
  onSlug,
  onType,
  onPatch,
}: PanelBodyProps) {
  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{panel.label}</legend>
      <div className="flex flex-col gap-4">
        {isCreate && (
          <>
            <TextField
              name="slug"
              label={t("questions.create.slug")}
              description={t("questions.create.slugHint")}
              value={slug}
              isRequired
              onChange={onSlug}
            />
            <div className="qcms-id-callout">
              <p className="text-xs uppercase tracking-wide text-(--color-text-muted)">
                {t("questions.create.id")}
              </p>
              <p className="qcms-id-callout__value">
                {questionId === "" ? t("questions.create.idPending") : questionId}
              </p>
              <p className="text-sm text-(--color-text-muted)">{t("questions.create.idNote")}</p>
            </div>
            <Select
              label={t("questions.create.type")}
              description={t("questions.create.typeNote")}
              value={definition.type}
              items={QUESTION_TYPES.map((type) => ({
                label: t(`questions.type.${type}`),
                value: type,
              }))}
              onChange={(next) => {
                onType(next as QuestionType);
              }}
            />
          </>
        )}
        <TextField
          label={t("questions.editor.label")}
          value={textOf(definition.label)}
          isRequired
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "label")}
          onChange={(next) => {
            onPatch({ label: localizedDraft(next) ?? {} });
          }}
        />
        <TextField
          label={t("questions.editor.help")}
          description={t("questions.editor.helpHint")}
          value={textOf(definition.help)}
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "help")}
          onChange={(next) => {
            onPatch({ help: localizedDraft(next) });
          }}
        />
        <Checkbox
          label={t("questions.editor.required")}
          isSelected={definition.required === true}
          isDisabled={isFrozen}
          onChange={(selected) => {
            onPatch({ required: selected });
          }}
        />
      </div>
    </fieldset>
  );
}

/* Query each selector in priority order; a selector list would return the first DOM match instead. */
const INVALID_TARGETS = [
  'input:not([type="hidden"]), textarea, select',
  '[role="spinbutton"]',
  'button, [tabindex="0"], [tabindex]',
] as const;

function firstInvalidControl(root: HTMLElement): HTMLElement | null {
  const flagged = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (flagged === null) return null;
  if (flagged.matches('input:not([type="hidden"]), textarea, select')) return flagged;
  for (const selector of INVALID_TARGETS) {
    const found = flagged.querySelector<HTMLElement>(selector);
    if (found !== null) return found;
  }
  return null;
}
