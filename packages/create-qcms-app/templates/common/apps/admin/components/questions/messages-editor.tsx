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

/* Derive message fields and wire cleanup from the same keys so removed constraints cannot retain orphan
   messages. */
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

  if (keys.length === 0) return null;

  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.editor.messages")}</legend>
      <p className="text-sm text-(--color-text-muted)">{t("questions.message.note")}</p>
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
    </fieldset>
  );
}

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
