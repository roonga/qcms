"use client";

import { t, type MessageKey } from "@/lib/i18n/en";

/* A question definition is authoring content, so the card shows every field of it: the digest binds the whole
   object, and a field the card did not show is a field nobody confirmed. */

interface Line {
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
}

function localized(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value as Record<string, unknown>)
    .filter(([, text]) => typeof text === "string")
    .map(([locale, text]) => `${locale}: ${String(text)}`)
    .join(" / ");
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

const FIELD_LABELS: Readonly<Record<string, MessageKey>> = {
  questionId: "forms.assist.definition.questionId",
  type: "forms.assist.definition.type",
  label: "forms.assist.definition.label",
  help: "forms.assist.definition.help",
  required: "forms.assist.definition.required",
};

function headLines(definition: Readonly<Record<string, unknown>>): readonly Line[] {
  const lines: Line[] = [];
  for (const [name, key] of Object.entries(FIELD_LABELS)) {
    const raw = definition[name];
    if (raw === undefined) continue;
    const value = name === "label" || name === "help" ? localized(raw) : scalar(raw);
    if (value === undefined || value === "") continue;
    lines.push({ label: t(key), value, mono: name === "questionId" });
  }
  return lines;
}

function mapLines(raw: unknown): readonly Line[] {
  if (typeof raw !== "object" || raw === null) return [];
  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({
    label: name,
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
  ...Object.keys(FIELD_LABELS),
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
      {lines.map((line) => (
        <dd key={`${heading}:${line.label}`}>
          <span className="qcms-acard__label">{line.label}</span>{" "}
          {line.mono ? <code>{line.value}</code> : <span>{line.value}</span>}
        </dd>
      ))}
    </>
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
          lines={mapLines(fields["constraints"])}
        />
        <Group
          heading={t("forms.assist.definition.messages")}
          lines={mapLines(fields["messages"])}
        />
        <Group
          heading={t("forms.assist.definition.options")}
          lines={choices.map((option) => ({
            label: option.optionId,
            value: option.label,
            mono: true,
          }))}
        />
        <Group heading={t("forms.assist.definition.other")} lines={mapLines(remainder(fields))} />
      </dl>
      <details>
        <summary>{t("forms.assist.definition.raw")}</summary>
        <pre>{JSON.stringify(definition, null, 2)}</pre>
      </details>
    </div>
  );
}
