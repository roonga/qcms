import { t, tPlural } from "../i18n/en.ts";
import { DEFAULT_LOCALE, formatDay } from "../i18n/format.ts";

import { CONSTRAINT_FIELDS, authoredMessageKeys, hasOptions, textOf } from "./definition.ts";
import { fieldPathOf } from "./errors.ts";
import type { DefinitionIssue, QuestionDefinitionView } from "./types.ts";

// Share panel decisions between the editor, parallel rail and refused-save focus path so they cannot disagree.

// Read constraints before their validation messages. Preview comes last and shows the saved version, not unsaved edits.
export const QUESTION_PANELS = [
  "content",
  "options",
  "constraints",
  "messages",
  "booleanLabels",
  "preview",
] as const;

export type QuestionPanelId = (typeof QUESTION_PANELS)[number];

export interface QuestionPanel {
  readonly id: QuestionPanelId;
  // Use the same name in rail rows and section legends so one panel cannot acquire two user-facing names.
  readonly label: string;

  readonly digest: string;

  readonly anchorId: string;
  // Derive field paths from present rows and message fields; error routing must match the controls actually rendered.
  readonly fields: readonly string[];
}

// Prefix panel ids to prevent collisions with option-row ids; navigation and focus must share the same anchor.
export function panelAnchorId(id: QuestionPanelId): string {
  return `panel-${id}`;
}

export const DEFAULT_QUESTION_PANEL: QuestionPanelId = "content";

// Omit panels with no applicable fields so a rail row never opens an empty destination.
export function questionPanels(
  definition: QuestionDefinitionView,
  options: { readonly withPreview?: boolean; readonly locale?: string } = {},
): readonly QuestionPanel[] {
  const panels: QuestionPanel[] = [
    panel("content", t("questions.panel.content"), contentDigest(definition), [
      "label",
      "help",
      "required",
      "questionId",
    ]),
  ];

  if (hasOptions(definition.type)) {
    const options = definition.options ?? [];
    panels.push(
      panel(
        "options",
        t("questions.options.legend"),
        tPlural(
          "questions.panel.optionsDigestOne",
          "questions.panel.optionsDigest",
          options.length,
        ),
        options.map((_option, index) => `options.${String(index)}.label`),
      ),
    );
  }

  const owned = CONSTRAINT_FIELDS[definition.type];
  if (owned.length > 0) {
    panels.push(
      panel(
        "constraints",
        t("questions.editor.constraints"),
        constraintsDigest(definition, owned, options.locale ?? DEFAULT_LOCALE),
        owned.map((field) => `constraints.${field}`),
      ),
    );
  }

  const messageKeys = authoredMessageKeys(definition);
  if (messageKeys.length > 0) {
    panels.push(
      panel(
        "messages",
        t("questions.editor.messages"),
        tPlural(
          "questions.panel.messagesDigestOne",
          "questions.panel.messagesDigest",
          messageKeys.length,
        ),
        messageKeys.map((key) => `messages.${key}`),
      ),
    );
  }

  if (definition.type === "boolean") {
    panels.push(
      panel("booleanLabels", t("questions.editor.booleanLabels"), booleanDigest(definition), [
        "yesLabel",
        "noLabel",
      ]),
    );
  }

  // Offer Preview only for a stored version the API can compile; creation has no saved document.
  if (options.withPreview === true) {
    panels.push(
      panel("preview", t("questions.preview.title"), t("questions.panel.previewDigest"), []),
    );
  }

  return panels;
}

function panel(
  id: QuestionPanelId,
  label: string,
  digest: string,
  fields: readonly string[],
): QuestionPanel {
  return { id, label, digest, anchorId: panelAnchorId(id), fields };
}

// Derive rendered paths from panels so every remaining issue reaches the summary rather than being swallowed.
export function renderedQuestionFields(panels: readonly QuestionPanel[]): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const one of panels) for (const field of one.fields) fields.add(field);
  return fields;
}

export function panelIssueCounts(
  panels: readonly QuestionPanel[],
  issues: readonly DefinitionIssue[],
): ReadonlyMap<QuestionPanelId, number> {
  const counts = new Map<QuestionPanelId, number>();
  for (const issue of issues) {
    const field = fieldPathOf(issue);
    if (field === undefined) continue;
    const owner = panels.find((one) => one.fields.includes(field));
    if (owner === undefined) continue;
    counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
  }
  return counts;
}

// Choose panel order rather than issue order so the author reaches the first field to fix in reading order.
export function firstPanelWithIssue(
  panels: readonly QuestionPanel[],
  counts: ReadonlyMap<QuestionPanelId, number>,
): QuestionPanelId | undefined {
  return panels.find((one) => (counts.get(one.id) ?? 0) > 0)?.id;
}

export const PANEL_PARAM = "panel";

// Use a query parameter: fragments never reach SSR, so separate trees could otherwise paint different panels.
// Unknown or inapplicable panels fall back to Content so bookmarks survive draft type changes.
export function panelFromParams(
  // Array.isArray widens readonly string arrays to any[]; match Next's mutable search-param shape to retain safe narrowing.
  params: Readonly<Record<string, string | string[] | undefined>>,
  panels: readonly QuestionPanel[],
): QuestionPanelId {
  const raw = params[PANEL_PARAM];
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  return panels.find((one) => one.id === wanted)?.id ?? DEFAULT_QUESTION_PANEL;
}

function contentDigest(definition: QuestionDefinitionView): string {
  return definition.required === true
    ? t("questions.panel.contentRequired")
    : t("questions.panel.contentOptional");
}

function constraintsDigest(
  definition: QuestionDefinitionView,
  owned: readonly string[],
  locale: string,
): string {
  const constraints = (definition.constraints ?? {}) as Readonly<Record<string, unknown>>;
  const parts: string[] = [];
  for (const field of owned) {
    const value = constraints[field];

    if (value === undefined || value === "" || value === false) continue;
    parts.push(constraintPart(definition, field, value, locale));
  }
  return parts.length === 0 ? t("questions.panel.constraintsNone") : parts.join(", ");
}

function constraintPart(
  definition: QuestionDefinitionView,
  field: string,
  value: unknown,
  locale: string,
): string {
  if (field === "pattern") return t("questions.panel.constraintPattern");
  if (field === "integer") return t("questions.panel.constraintInteger");
  // Format date bounds in UTC: canonical calendar dates parse at UTC midnight and would shift a day west of UTC.
  const isLower = field === "min" || field === "minLength" || field === "minSelected";
  if (definition.type === "date" && typeof value === "string") {
    return t(isLower ? "questions.panel.constraintFrom" : "questions.panel.constraintTo", {
      value: formatDay(value, { locale, timeZone: "UTC" }, value),
    });
  }
  return t(isLower ? "questions.panel.constraintMin" : "questions.panel.constraintMax", {
    value: String(value),
  });
}

function booleanDigest(definition: QuestionDefinitionView): string {
  const yes = textOf(definition.yesLabel);
  const no = textOf(definition.noLabel);
  return `${yes === "" ? t("questions.booleanLabel.defaultYes") : yes} / ${
    no === "" ? t("questions.booleanLabel.defaultNo") : no
  }`;
}

// Resolve panels and selection together for both server trees; saved detail always includes Preview.
export function questionPanelState(
  definition: QuestionDefinitionView,
  params: Readonly<Record<string, string | string[] | undefined>>,
  locale: string = DEFAULT_LOCALE,
): { readonly panels: readonly QuestionPanel[]; readonly panel: QuestionPanelId } {
  const panels = questionPanels(definition, { withPreview: true, locale });
  return { panels, panel: panelFromParams(params, panels) };
}
