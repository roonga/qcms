"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Checkbox, Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  CONSTRAINT_FIELDS,
  blankDefinition,
  forWire,
  hasOptions,
  localized,
  questionIdFromSlug,
  textOf,
} from "@/lib/questions/definition";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import {
  fieldErrorProps,
  issuesByField,
  optionalProp,
  unplacedIssues,
} from "@/lib/questions/errors";
import {
  QUESTION_TYPES,
  type ChoiceOptionView,
  type ConstraintsView,
  type QuestionDefinitionView,
  type QuestionType,
} from "@/lib/questions/types";

import { ConstraintsEditor } from "./constraints-editor";
import { OptionListEditor } from "./option-list-editor";

/**
 * The question editor (task 032; wireframe "editor `form`").
 *
 * One component for both creating and editing, because they are the same form with two
 * fields unlocked: creation is the only moment `slug` and `type` can be chosen, and the
 * whole point of the screen is that this is a one-way door. Splitting them into two
 * components would duplicate the constraint panels, the option editor, the error
 * placement and the submit handling to express a two-field difference.
 *
 * ## The document is held here, and sent as one field
 *
 * The form posts a single serialized `definition`, assembled from this component's state.
 * The alternative - a form field per constraint, reassembled on the server - would put
 * "which constraints does a `date` question have?" inside the BFF, which is a domain
 * question the admin has no authority over (R2). Sending the document whole keeps the
 * server side to `JSON.parse` and forward, and keeps the kernel the only thing that has
 * ever decided what a question is.
 *
 * The trade is that editing needs JavaScript. That is a deliberate, narrow concession:
 * 031's credential screens still work with JavaScript off (a respondent or an operator
 * must always be able to sign in), but an authoring tool with a live option list and a
 * per-type constraint panel is not a form that degrades meaningfully, and the operator
 * audience is internal (ARCHITECTURE §6).
 *
 * ## Where errors land
 *
 * The kernel reports issues by domain path, so `["constraints","maxSelected"]` is exactly
 * the address of the "Most selections" field. Every issue whose path matches a rendered
 * field is shown on that field; anything left over is listed in the alert at the top
 * rather than dropped, which is what makes "every error is surfaced somewhere readable"
 * hold for codes this screen has never seen.
 */
export function QuestionEditor({
  mode,
  action,
  initialSlug,
  initialDefinition,
  version,
  isFrozen = false,
}: {
  readonly mode: "create" | "edit";
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly initialSlug: string;
  readonly initialDefinition: QuestionDefinitionView;
  readonly version: number;
  readonly isFrozen?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_MUTATION);
  // Seeded from the rejected submission when there is one, so a refusal that arrived via
  // a pre-hydration full POST (see `MutationState.submitted`) still shows the author the
  // document they wrote rather than an empty form under an error message.
  const [slug, setSlug] = useState(state.submitted?.slug ?? initialSlug);
  const [definition, setDefinition] = useState<QuestionDefinitionView>(
    state.submitted?.definition ?? initialDefinition,
  );
  // And the same restoration when the form was hydrated, where the component is not
  // remounted and the initialiser above never runs again. Adjusting state during render
  // (rather than in an effect) is React's documented answer for "derive from a prop that
  // just changed": it re-renders before the browser paints, so no empty intermediate
  // frame is ever shown.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.submitted !== undefined) {
      setSlug(state.submitted.slug);
      setDefinition(state.submitted.definition);
    }
  }

  const isCreate = mode === "create";
  const questionId = isCreate ? questionIdFromSlug(slug) : definition.questionId;
  const issues = issuesByField(state.issues ?? []);

  /** Changing the type in creation starts a fresh document: constraints do not carry. */
  function changeType(next: QuestionType): void {
    setDefinition(blankDefinition(next, questionId));
  }

  function patch(fields: Partial<QuestionDefinitionView>): void {
    setDefinition((current) => ({ ...current, ...fields }));
  }

  const rendered = renderedFields(definition);
  const leftover = unplacedIssues(state.issues ?? [], rendered);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* The whole document, as one field. See the note above on why. */}
      <input type="hidden" name="definition" value={JSON.stringify(forWire(definition))} />
      <input type="hidden" name="questionId" value={questionId} />
      <input type="hidden" name="version" value={String(version)} />
      {/* In creation the slug is a real field; here it is carried so a rejected save can
          echo the whole submission back intact. */}
      {!isCreate && <input type="hidden" name="slug" value={slug} />}

      {state.status === "error" && (
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
      )}
      {state.status === "saved" && <Alert variant="success">{t("questions.editor.saved")}</Alert>}

      {isCreate ? (
        <div className="flex flex-col gap-4">
          <TextField
            name="slug"
            label={t("questions.create.slug")}
            description={t("questions.create.slugHint")}
            value={slug}
            isRequired
            onChange={(next) => {
              setSlug(next);
              patch({ questionId: questionIdFromSlug(next) });
            }}
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
              changeType(next as QuestionType);
            }}
          />
        </div>
      ) : (
        <p className="text-sm text-(--color-text-muted)">
          {t("questions.editor.typeLocked", { type: t(`questions.type.${definition.type}`) })}
        </p>
      )}

      <TextField
        label={t("questions.editor.label")}
        value={textOf(definition.label)}
        isRequired
        isDisabled={isFrozen}
        {...fieldErrorProps(issues, "label")}
        onChange={(next) => {
          patch({ label: localized(next) ?? {} });
        }}
      />
      <TextField
        label={t("questions.editor.help")}
        description={t("questions.editor.helpHint")}
        value={textOf(definition.help)}
        isDisabled={isFrozen}
        {...fieldErrorProps(issues, "help")}
        onChange={(next) => {
          patch({ help: localized(next) });
        }}
      />
      <Checkbox
        label={t("questions.editor.required")}
        isSelected={definition.required === true}
        isDisabled={isFrozen}
        onChange={(selected) => {
          patch({ required: selected });
        }}
      />

      {hasOptions(definition.type) && (
        <OptionListEditor
          options={definition.options ?? []}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(options: readonly ChoiceOptionView[]) => {
            patch({ options });
          }}
        />
      )}

      <ConstraintsEditor
        type={definition.type}
        constraints={definition.constraints ?? {}}
        issues={issues}
        isFrozen={isFrozen}
        onChange={(constraints: ConstraintsView) => {
          patch({ constraints });
        }}
      />

      {!isFrozen && (
        <div>
          <Button type="submit" variant="primary" size="md" isDisabled={isPending}>
            {isCreate ? t("questions.create.submit") : t("questions.editor.save")}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * The field paths this form actually renders, so anything else can be reported instead of
 * silently swallowed. Derived from the document rather than listed, because the option
 * rows come and go.
 */
function renderedFields(definition: QuestionDefinitionView): ReadonlySet<string> {
  const fields = new Set<string>(["label", "help", "required", "questionId"]);
  for (const key of CONSTRAINT_FIELDS[definition.type]) fields.add(`constraints.${key}`);
  (definition.options ?? []).forEach((_option, index) => {
    fields.add(`options.${index}.label`);
  });
  return fields;
}
