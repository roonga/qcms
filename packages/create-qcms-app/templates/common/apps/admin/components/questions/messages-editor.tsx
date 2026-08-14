"use client";

import { TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  authoredMessageKeys,
  defaultMessageFor,
  localizedDraft,
  messageLabelFor,
  textOf,
  withMessage,
} from "@/lib/questions/definition";
import { fieldErrorProps } from "@/lib/questions/errors";
import type {
  DefinitionIssue,
  LocalizedText,
  QuestionDefinitionView,
  ValidationMessagesView,
} from "@/lib/questions/types";

/**
 * Author-supplied validation messages (task 048, ADR-32) and the boolean label overrides
 * (ADR-36), as two panels of the question editor.
 *
 * ## The whole feature is one rule, stated once
 *
 * A field is rendered for exactly the keys `authoredMessageKeys` returns, and nothing
 * else. That single line is what makes the kernel's `ORPHAN_MESSAGE_KEY` **unreachable
 * from this screen** rather than merely caught by it: unticking "an answer is required" or
 * clearing "Shortest answer" removes the field, and `forWire` drops the orphaned message
 * in the same breath, because both read the same function. There is no second list here
 * saying which fields exist.
 *
 * ## Placeholder, not default value
 *
 * ADR-32 puts the fallback at the **edit** level: the box shows what a respondent would
 * see today and an empty box means "keep showing that". Seeding the default as the field's
 * *value* was the other option and it is worse in a way that cannot be undone - every
 * author who saved a question would have silently frozen a copy of today's default into
 * the stored definition, so improving the shipped wording later would reach nobody. A
 * placeholder cannot be saved by accident.
 *
 * ## Why this is its own panel rather than a field per constraint row
 *
 * 032's `constraints-editor.tsx` anticipated one message input threaded into each
 * constraint control. Two things pushed against that once the kernel side existed.
 * `required` is not a constraint at all (it is a checkbox above the panel, and it is the
 * one key every type can carry), so a per-row layout would have split the feature across
 * two places. And the fields have to appear and disappear as constraints come and go,
 * which is one derived list here versus seven panels each re-deriving it. The constraint
 * panels are untouched by this task as a result.
 */
export function MessagesEditor({
  definition,
  issues,
  isFrozen,
  onChange,
}: {
  readonly definition: QuestionDefinitionView;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
  readonly onChange: (messages: ValidationMessagesView) => void;
}) {
  const keys = authoredMessageKeys(definition);
  const messages = definition.messages ?? {};

  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.editor.messages")}</legend>
      <p className="text-sm text-(--color-text-muted)">{t("questions.message.note")}</p>
      {keys.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("questions.message.none")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((key) => (
            <TextField
              key={key}
              label={messageLabelFor(key, definition)}
              placeholder={defaultMessageFor(key, definition)}
              value={textOf(messages[key])}
              isDisabled={isFrozen}
              {...fieldErrorProps(issues, `messages.${key}`)}
              onChange={(next) => {
                onChange(withMessage(messages, key, next));
              }}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The two displayed labels of a boolean question (ADR-36), same placeholder-inherit
 * mechanism as the messages above.
 *
 * Rendered only for `boolean`, and `forWire` drops both fields for every other type, so a
 * draft that was briefly a boolean cannot carry a label the kernel would refuse.
 *
 * Each label is independent: overriding "Yes" leaves "No" on the compiler's
 * `BOOLEAN_AFFIRMATION` lexicon, which is why these are two fields rather than one paired
 * control. The panel says out loud that the stored answer is unchanged, because "rename
 * the choices" is exactly the edit an author might expect to change what a rule matches
 * on - it does not.
 */
export function BooleanLabelsEditor({
  definition,
  issues,
  isFrozen,
  onChange,
}: {
  readonly definition: QuestionDefinitionView;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
  readonly onChange: (fields: {
    readonly yesLabel?: LocalizedText | undefined;
    readonly noLabel?: LocalizedText | undefined;
  }) => void;
}) {
  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.editor.booleanLabels")}</legend>
      <p className="text-sm text-(--color-text-muted)">{t("questions.booleanLabel.note")}</p>
      <div className="qcms-constraints">
        <TextField
          label={t("questions.booleanLabel.yes")}
          placeholder={t("questions.booleanLabel.defaultYes")}
          value={textOf(definition.yesLabel)}
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "yesLabel")}
          onChange={(next) => {
            onChange({ yesLabel: localizedDraft(next) });
          }}
        />
        <TextField
          label={t("questions.booleanLabel.no")}
          placeholder={t("questions.booleanLabel.defaultNo")}
          value={textOf(definition.noLabel)}
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "noLabel")}
          onChange={(next) => {
            onChange({ noLabel: localizedDraft(next) });
          }}
        />
      </div>
    </fieldset>
  );
}
