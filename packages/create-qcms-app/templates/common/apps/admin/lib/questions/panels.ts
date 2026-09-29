import { t, tPlural } from "../i18n/en.ts";
import { formatDay } from "../i18n/format.ts";

import { CONSTRAINT_FIELDS, authoredMessageKeys, hasOptions, textOf } from "./definition.ts";
import { fieldPathOf } from "./errors.ts";
import type { DefinitionIssue, QuestionDefinitionView } from "./types.ts";

/**
 * Which panels the question editor has, as a decision rather than as markup (Code Owner,
 * 2026-09-27).
 *
 * ## Why the editor grew panels at all
 *
 * The editor used to be one column: the label, the help text, the required box, the option
 * grid, the constraint panel, the message panel and the boolean labels, stacked. On a
 * nine-option single choice that is a screen and a half of scrolling to reach a constraint,
 * with the Save button somewhere below all of it. The form builder answered the same problem
 * the same way - `lib/forms/builder-bridge.ts` records it - and the rail is what switches
 * between the pieces there, so it is what switches between them here.
 *
 * ## Why this is a module and not a list inside the component
 *
 * Three readers have to agree about which panels exist and what is in them, and two of them
 * are in different React trees: the editor renders a panel, the rail beside it renders a row
 * per panel with a digest and an issue badge, and the refused-save path picks the first panel
 * carrying an issue. A second list would be a rail row for a panel that is not there, or an
 * issue counted against a panel that cannot show it.
 *
 * **Nothing here is a new source of truth about the question model.** Which types carry
 * options is {@link hasOptions}, which constraints a type owns is {@link CONSTRAINT_FIELDS},
 * and which message keys a question can hold is {@link authoredMessageKeys} - the same three
 * functions the editor already rendered from. This module arranges their answers; it does not
 * restate them. That is what keeps a type gaining a constraint from needing an edit here.
 */

/**
 * The panels, in the order the editor stacked their sections and the rail lists their rows.
 *
 * Content first because it is the only one every type has, and the one an author reaches for
 * without being sent there. The next four keep the order the single column had, which is the
 * order task 048 argued for at the time: a message field only exists for a constraint above
 * it, so an author reads the constraint and then the sentence a respondent gets when they
 * miss it.
 *
 * PREVIEW IS LAST (Code Owner, 2026-09-27), and it is the one panel that is not a set of
 * fields. It used to be a card above the editor, on screen whatever the author was doing, so
 * it took the top of the column permanently for a question that is only asked at the end -
 * "what does this look like to a respondent". Last in the list is where that question sits,
 * and it is the only row whose panel shows the SAVED version rather than the document being
 * typed, which the panel itself says when the two differ.
 */
export const QUESTION_PANELS = [
  "content",
  "options",
  "constraints",
  "messages",
  "booleanLabels",
  "preview",
] as const;

/** One panel of the question editor. */
export type QuestionPanelId = (typeof QUESTION_PANELS)[number];

/** One panel, as the editor renders it and the rail lists it. */
export interface QuestionPanel {
  readonly id: QuestionPanelId;
  /**
   * The panel's name, which is the legend its own section carries.
   *
   * The same string in both places on purpose: `apps/admin/app/(shell)/AGENTS.md` says the
   * rail must not give a screen a second name for a place the screen's own copy already
   * names, and a rail row reading "Choices" above a fieldset reading "Options" is two names
   * for one panel.
   */
  readonly label: string;
  /** A few words saying what is in the panel, for the rail row under the name. */
  readonly digest: string;
  /** The panel section's DOM id: what a rail row controls, and where focus is sent. */
  readonly anchorId: string;
  /**
   * The issue paths this panel is able to show, as dotted kernel paths.
   *
   * Derived rather than listed, because the option rows and the message fields come and go.
   * The union of these is exactly the set the error summary tests an issue against, which is
   * why {@link renderedQuestionFields} is built from it rather than from a parallel list.
   */
  readonly fields: readonly string[];
}

/**
 * A panel section's DOM id, which is what a rail row's `aria-controls` names and what the
 * refused-save path looks a panel up by to move focus into it.
 *
 * `panel-` rather than the bare id, so the ids the editor mints cannot collide with anything
 * else on a screen that also carries an option grid's own row ids. Minted here rather than
 * written at each end, so the two halves of that equality cannot drift.
 */
export function panelAnchorId(id: QuestionPanelId): string {
  return `panel-${id}`;
}

/**
 * The panel the editor opens on when the address names none.
 *
 * Content, because it is the only panel every type has and the only one whose fields a
 * question cannot be saved without.
 */
export const DEFAULT_QUESTION_PANEL: QuestionPanelId = "content";

/**
 * The panels this question has, in {@link QUESTION_PANELS} order.
 *
 * A panel is absent rather than empty when the question has nothing for it: a boolean has no
 * constraints to set, a number has no options, and a question with no constraint set has no
 * message to write. The editor used to render the empty panel with a sentence saying it was
 * empty, which is the right answer for one stacked column and the wrong one for a rail - a row
 * that opens a panel reading "there is nothing here" is a row that should not be there.
 *
 * Both of those sentences are therefore gone, along with their catalog entries
 * (`questions.editor.noConstraints`, `questions.message.none`): an empty state is the absence of
 * a row now. `constraints-editor.tsx` and `messages-editor.tsx` record the same call at their
 * own end, because each of them is the half that stopped rendering.
 */
export function questionPanels(
  definition: QuestionDefinitionView,
  options: { readonly withPreview?: boolean } = {},
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
        constraintsDigest(definition, owned),
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

  // ONLY WHERE THERE IS A SAVED VERSION TO PREVIEW. `/questions/new` passes nothing: it has
  // no rail to reach a panel from, and there is no stored version for the API to compile, so
  // a Preview row there would open a panel with nothing in it. It carries no fields either,
  // which is why it contributes nothing to `renderedQuestionFields` and can never be the
  // panel a refused save opens.
  if (options.withPreview === true) {
    panels.push(
      panel("preview", t("questions.preview.title"), t("questions.panel.previewDigest"), []),
    );
  }

  return panels;
}

/** One panel, with its anchor minted from its id so no caller writes the id twice. */
function panel(
  id: QuestionPanelId,
  label: string,
  digest: string,
  fields: readonly string[],
): QuestionPanel {
  return { id, label, digest, anchorId: panelAnchorId(id), fields };
}

/**
 * The field paths the editor's panels can show, so anything else is reported in the summary
 * instead of being silently swallowed.
 *
 * This is `renderedFields`, which used to live in `question-editor.tsx` as a second
 * hand-written list beside the one the panels are built from. Exit criterion 1 of task 032 is
 * "every error surfaced somewhere readable", and the two lists agreeing was what made it
 * hold; one list is what makes it hold without being checked.
 */
export function renderedQuestionFields(panels: readonly QuestionPanel[]): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const one of panels) for (const field of one.fields) fields.add(field);
  return fields;
}

/**
 * How many issues each panel is carrying, for the rail's badges.
 *
 * Only the panels that have some appear in the map, exactly as the builder's step counts do,
 * so a rail row has no all-clear to fabricate: with nothing refused there are no entries and
 * no badges, rather than a row of reassuring zeroes.
 */
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

/**
 * The panel a refused save should open, or `undefined` when no panel can show any of it.
 *
 * Panel order rather than issue order, so a refusal naming a constraint and a label opens
 * Content: the author is sent to the first thing they have to fix reading downwards, which is
 * the order they wrote the question in.
 */
export function firstPanelWithIssue(
  panels: readonly QuestionPanel[],
  counts: ReadonlyMap<QuestionPanelId, number>,
): QuestionPanelId | undefined {
  return panels.find((one) => (counts.get(one.id) ?? 0) > 0)?.id;
}

/** The query parameter the open panel is addressed by. */
export const PANEL_PARAM = "panel";

/**
 * Which panel the address opens, decided in one place for the two trees that render it.
 *
 * ## Why a query parameter and not a fragment
 *
 * A **fragment never reaches the server**, and both halves of this screen are server-rendered
 * from the address: the editor renders one panel and the rail marks one row current. Read from
 * a fragment, each would have to render a guess and correct it once the browser had hydrated,
 * which is a flash on the panel and a hydration mismatch on the row. `?panel=` is read by the
 * server, so the first paint is already right in both trees, and a reload or a pasted link
 * lands on the panel it names.
 *
 * That is `lib/settings-sections.ts`'s `settingsSectionFromParams` applied here, which is the
 * app's existing answer for a same-page panel switch, and `lib/questions/version-rail.ts`'s
 * `selectVersion` for the same reason one layer up: two React trees rendered from one URL
 * cannot hand each other a value, so both ask one pure function about the same address. A
 * disagreement would be a screen saying two things - a row marked current beside another
 * panel's fields.
 *
 * ## Why an unknown panel falls back rather than 404ing
 *
 * `selectVersion` above it makes the same call for the same reason: the panels a question has
 * depend on the document, so a link to `?panel=constraints` stays a working link to the
 * question after someone changes the draft's type to one with no constraints. Content is what
 * it lands on, and the address is left as it was.
 */
export function panelFromParams(
  // The shape Next hands a page, and the shape `selectVersion` next door takes, rather than a
  // `readonly` variant of it: `Array.isArray` widens a `readonly string[]` to `any[]`, so the
  // stricter-looking signature is the one that puts an `any` in the middle of this function.
  params: Readonly<Record<string, string | string[] | undefined>>,
  panels: readonly QuestionPanel[],
): QuestionPanelId {
  const raw = params[PANEL_PARAM];
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  return panels.find((one) => one.id === wanted)?.id ?? DEFAULT_QUESTION_PANEL;
}

/** Whether the question needs an answer, which is the one thing Content states about itself. */
function contentDigest(definition: QuestionDefinitionView): string {
  return definition.required === true
    ? t("questions.panel.contentRequired")
    : t("questions.panel.contentOptional");
}

/**
 * The constraints that carry a value, written out short.
 *
 * Terse on purpose: the rail track is 240px and this line sits under the panel's name, so
 * "min 0, max 200" is what fits where "Smallest value 0, largest value 200" would not. The
 * field's own label is on the control the row opens, which is where an author reads the long
 * form.
 */
function constraintsDigest(definition: QuestionDefinitionView, owned: readonly string[]): string {
  const constraints = (definition.constraints ?? {}) as Readonly<Record<string, unknown>>;
  const parts: string[] = [];
  for (const field of owned) {
    const value = constraints[field];
    // The same "did the author leave a value here?" test `forWire` prunes on, plus `false`
    // for the one boolean constraint: an unticked "whole numbers only" is not a constraint.
    if (value === undefined || value === "" || value === false) continue;
    parts.push(constraintPart(definition, field, value));
  }
  return parts.length === 0 ? t("questions.panel.constraintsNone") : parts.join(", ");
}

/** One constraint, in the shortest phrase that still says which bound it is. */
function constraintPart(definition: QuestionDefinitionView, field: string, value: unknown): string {
  if (field === "pattern") return t("questions.panel.constraintPattern");
  if (field === "integer") return t("questions.panel.constraintInteger");
  // A DATE BOUND READS AS A RANGE, NOT AS AN EXTREME. "min Jan 1, 2030" is the same fact as
  // "from Jan 1, 2030" and the second is how the fields themselves are labelled ("Earliest
  // date", "Latest date"), so the digest says it the way the panel does. The day is rendered
  // through the shared formatter rather than shown as the wire string, ADR-27's rule, and it
  // is UTC for the reason the rail's version dates are (issue #582).
  const isLower = field === "min" || field === "minLength" || field === "minSelected";
  if (definition.type === "date" && typeof value === "string") {
    return t(isLower ? "questions.panel.constraintFrom" : "questions.panel.constraintTo", {
      value: formatDay(value, value),
    });
  }
  return t(isLower ? "questions.panel.constraintMin" : "questions.panel.constraintMax", {
    value: String(value),
  });
}

/**
 * The two labels a respondent would actually see, which is what the panel is about.
 *
 * The effective pair rather than a count of overrides: "Yes / No" and "Agree / Decline" are
 * both one glance, and "1 override" tells an author nothing about which choice reads how.
 * The defaults come from the same catalog entries the panel shows as placeholders (ADR-36).
 */
function booleanDigest(definition: QuestionDefinitionView): string {
  const yes = textOf(definition.yesLabel);
  const no = textOf(definition.noLabel);
  return `${yes === "" ? t("questions.booleanLabel.defaultYes") : yes} / ${
    no === "" ? t("questions.booleanLabel.defaultNo") : no
  }`;
}

/**
 * The panels of one saved version, and which of them the address opens, resolved together.
 *
 * The detail screen's page and its rail slot are two React trees rendered from one URL, and both
 * need both answers. They used to compute them as two lines each, which is two places for the
 * `withPreview` flag to disagree and two runs of identical code for the duplication gate to
 * notice. One call each is also the honest statement of what the seam is: "the two trees read the
 * same address through the same function" is a single function now rather than a convention.
 *
 * `withPreview` is fixed rather than a parameter, because both callers are the detail screen,
 * where there is always a stored version to compile. `/questions/new` has neither a rail nor a
 * saved version and calls {@link questionPanels} directly.
 */
export function questionPanelState(
  definition: QuestionDefinitionView,
  params: Readonly<Record<string, string | string[] | undefined>>,
): { readonly panels: readonly QuestionPanel[]; readonly panel: QuestionPanelId } {
  const panels = questionPanels(definition, { withPreview: true });
  return { panels, panel: panelFromParams(params, panels) };
}
