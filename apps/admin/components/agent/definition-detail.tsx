"use client";

import { localeName } from "@/lib/agent/card-copy";
import { t, type MessageKey } from "@/lib/i18n/en";
import { QUESTION_TYPES, type QuestionType } from "@/lib/questions/types";

/* A question definition is authoring content, so the card shows every field of it: the digest binds the whole
   object, and a field the card did not show is a field nobody confirmed. */

interface Line {
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
}

/* One locale is the form's own, so its text stands alone; several are told apart by the
   language's name rather than by the tag the definition carries. */
function localized(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, text]) => typeof text === "string",
  );
  const [sole] = entries;
  if (sole === undefined) return undefined;
  if (entries.length === 1) return String(sole[1]);
  return entries
    .map(([locale, text]) => `${localeName(locale) ?? locale}: ${String(text)}`)
    .join(" / ");
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

const HEAD_FIELDS: readonly string[] = ["type", "label", "help", "required"];

/* `required` carries the editor's whole sentence, so it takes no label of its own. */
const FIELD_LABELS: Readonly<Record<string, MessageKey>> = {
  type: "forms.assist.definition.type",
  label: "forms.assist.definition.label",
  help: "forms.assist.definition.help",
};

function isQuestionType(raw: unknown): raw is QuestionType {
  return typeof raw === "string" && (QUESTION_TYPES as readonly string[]).includes(raw);
}

/* The card writes a question the way the question screens write it, so a type is its own name
   and whether an answer is required is the editor's own sentence. */
function headValue(name: string, raw: unknown): string | undefined {
  if (name === "label" || name === "help") return localized(raw);
  if (name === "type" && isQuestionType(raw)) return t(`questions.type.${raw}` as MessageKey);
  if (name === "required" && typeof raw === "boolean") {
    return t(raw ? "forms.assist.definition.requiredYes" : "forms.assist.definition.requiredNo");
  }
  return scalar(raw);
}

function headLines(definition: Readonly<Record<string, unknown>>): readonly Line[] {
  const lines: Line[] = [];
  for (const name of HEAD_FIELDS) {
    const raw = definition[name];
    if (raw === undefined) continue;
    const value = headValue(name, raw);
    if (value === undefined || value === "") continue;
    const key = FIELD_LABELS[name];
    lines.push({ label: key === undefined ? "" : t(key), value, mono: false });
  }
  return lines;
}

const FIELD_KEYS: ReadonlySet<string> = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "integer",
  "min",
  "max",
  "minSelected",
  "maxSelected",
  "required",
  "yesLabel",
  "noLabel",
]);

const DATED_KEYS: Readonly<Record<string, string>> = { min: "dateMin", max: "dateMax" };

/** `min` and `max` are a date on a date question and a number everywhere else. */
function fieldLabel(name: string, type: unknown): string {
  if (!FIELD_KEYS.has(name)) return name;
  const key = (type === "date" ? DATED_KEYS[name] : undefined) ?? name;
  return t(`forms.assist.definition.field.${key}` as MessageKey);
}

function mapLines(raw: unknown, type: unknown): readonly Line[] {
  if (typeof raw !== "object" || raw === null) return [];
  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({
    label: fieldLabel(name, type),
    value: localized(value) ?? scalar(value),
    mono: name === "pattern",
  }));
}

interface Option {
  readonly optionId: string;
  readonly label: string;
}

function options(raw: unknown): readonly Option[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const optionId = typeof row["optionId"] === "string" ? row["optionId"] : "";
    return [{ optionId, label: localized(row["label"]) ?? "" }];
  });
}

const GROUPED: readonly string[] = [
  ...HEAD_FIELDS,
  "questionId",
  "constraints",
  "messages",
  "options",
];

/* Whatever the kernel allows that the groups above do not name, so no field goes unshown. */
function remainder(definition: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(definition).filter(([name]) => !GROUPED.includes(name)));
}

function Group({
  heading,
  lines,
}: {
  readonly heading: string;
  readonly lines: readonly Line[];
}): React.ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <>
      <dt className="qcms-acard__subhead">{heading}</dt>
      {lines.map((line, at) => (
        <dd key={`${heading}:${String(at)}:${line.label}`}>
          {line.label === "" ? null : (
            <>
              <span className="qcms-acard__label">{line.label}</span>{" "}
            </>
          )}
          {line.mono ? <code>{line.value}</code> : <span>{line.value}</span>}
        </dd>
      ))}
    </>
  );
}

/* The question is named by its label and its answers by theirs, as the step above it is named
   by its title; the ids behind them stay reachable for support. */
function DefinitionIds({
  questionId,
  choices,
}: {
  readonly questionId: unknown;
  readonly choices: readonly Option[];
}): React.ReactElement | null {
  const id = typeof questionId === "string" && questionId !== "" ? questionId : undefined;
  const withIds = choices.filter((option) => option.optionId !== "");
  if (id === undefined && withIds.length === 0) return null;
  return (
    <details className="qcms-acard__ids" data-testid="qcms-acard-definition-ids">
      <summary>{t("agent.card.ids")}</summary>
      <p className="qcms-acard__args">
        {id === undefined ? null : (
          <span>
            {t("forms.assist.definition.questionId")} <code>{id}</code>
          </span>
        )}
        {withIds.map((option, at) => (
          <span key={`${option.optionId}:${String(at)}`}>
            {option.label} <code>{option.optionId}</code>
          </span>
        ))}
      </p>
    </details>
  );
}

/** One question definition, field by field, with the whole object behind a disclosure. */
export function DefinitionDetail({
  definition,
}: {
  readonly definition: unknown;
}): React.ReactElement | null {
  if (typeof definition !== "object" || definition === null) return null;
  const fields = definition as Record<string, unknown>;
  const choices = options(fields["options"]);

  return (
    <div className="qcms-acard__definition" data-testid="qcms-acard-definition">
      <dl className="qcms-acard__deflist">
        <Group heading={t("forms.assist.definition.question")} lines={headLines(fields)} />
        <Group
          heading={t("forms.assist.definition.constraints")}
          lines={mapLines(fields["constraints"], fields["type"])}
        />
        <Group
          heading={t("forms.assist.definition.messages")}
          lines={mapLines(fields["messages"], fields["type"])}
        />
        <Group
          heading={t("forms.assist.definition.options")}
          lines={choices.map((option) => ({ label: "", value: option.label, mono: false }))}
        />
        <Group
          heading={t("forms.assist.definition.other")}
          lines={mapLines(remainder(fields), fields["type"])}
        />
      </dl>
      <DefinitionIds questionId={fields["questionId"]} choices={choices} />
      <details>
        <summary>{t("forms.assist.definition.raw")}</summary>
        <pre>{JSON.stringify(definition, null, 2)}</pre>
      </details>
    </div>
  );
}
