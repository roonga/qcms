import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { isPinned } from "./draft.ts";
import type { DraftForm, DraftPin, PinnableQuestion } from "./types.ts";

/**
 * What the add-question dialog lists, and what its selection state makes of each row.
 *
 * ## Why this is a module and not a block inside the component
 *
 * `components/forms/library-picker.tsx` is a react-aria `Dialog`, and a Dialog renders
 * through a portal that server rendering has nowhere to put, so `renderToStaticMarkup`
 * hands back the empty string for the whole subtree (issue 628). The admin's unit layer is
 * that static render and nothing else: there is no jsdom and no testing-library in this
 * app, so a `useState` transition is not observable below the browser at all.
 *
 * Multi-select's actual rules - which row keeps a checkbox once a sibling version is
 * chosen, what the chosen pane shows when a search hides a chosen row, what order the
 * pins land in - are therefore written here as pure functions over their inputs, where
 * `picker-selection.test.ts` can state each one directly. What is left in the component
 * is markup and the `useState` call, and the browser walk that proves the two are wired
 * together is `e2e/picker-multi-select.pw.ts` (ADR-23: e2e at the highest layer that
 * exists for it).
 *
 * Nothing here reaches for the network or the draft store. `chosen` is the dialog's own
 * client state, handed in.
 */

/** `questionId@version`: the pin a row would create, and so its identity in the list. */
export function rowId(questionId: string, version: number): string {
  return `${questionId}@${String(version)}`;
}

/** One listed version, with whether this form may pin it. */
export interface PickerRow {
  readonly questionId: string;
  readonly label: string;
  readonly type: string;
  readonly version: number;
  readonly state: string;
  readonly pinnable: boolean;
}

/** A listed row plus what the dialog's own selection state makes of it. */
export interface ChoiceRow extends PickerRow {
  /** Whether this exact version is in the chosen set. */
  readonly checked: boolean;
  /**
   * Whether to render a checkbox at all. Narrower than `pinnable`: a version the form
   * could pin still loses its control while a SIBLING version of the same question is
   * chosen, because the form may only hold one pin per question.
   */
  readonly choosable: boolean;
}

/** A chosen pin resolved against the library, so the pane can name what it will add. */
export interface ChosenRow extends DraftPin {
  readonly label: string;
}

/** Whether a question matches the free-text box, over the id, slug and label. */
function matches(question: PinnableQuestion, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = `${question.questionId} ${question.slug} ${textOf(question.label ?? undefined)}`;
  return haystack.toLowerCase().includes(needle);
}

function stateLabel(already: boolean, status: string): string {
  if (already) return t("forms.picker.statePinned");
  if (status === "deprecated") return t("forms.picker.stateDeprecated");
  return t("forms.picker.statePinnable");
}

/** The version rows, with the ones this form cannot pin marked as such. */
export function pinnableRows(
  library: readonly PinnableQuestion[],
  draft: DraftForm,
  search: string,
): PickerRow[] {
  const rows: PickerRow[] = [];

  for (const question of library) {
    if (!matches(question, search)) continue;
    const already = isPinned(draft, question.questionId);
    for (const version of question.versions) {
      // A draft version is not pinnable and never will be as it stands, so it is not
      // listed at all: showing it would only invite the question of why it is refused.
      if (version.status === "draft") continue;
      rows.push({
        questionId: question.questionId,
        label: textOf(question.label ?? undefined),
        type:
          question.type === null
            ? t("questions.column.typeUnknown")
            : t(`questions.type.${question.type}`),
        version: version.version,
        state: stateLabel(already, version.status),
        pinnable: !already && version.status !== "deprecated",
      });
    }
  }
  return rows;
}

/**
 * Fold the chosen set into the listed rows.
 *
 * ONE PIN PER QUESTION, enforced while choosing rather than at the commit. The kernel
 * refuses a second pin of the same question (`DUPLICATE_QUESTION_IN_FORM`), and one row
 * per version means an author could otherwise tick `q_x@2` and `q_x@3` together and learn
 * at the commit that only one of them landed. So a chosen version withdraws the checkbox
 * from its siblings, and their State cell names the version holding the place - the same
 * shape as every other refusal in this table: no control, and the reason in words.
 */
export function withChoices(
  rows: readonly PickerRow[],
  chosen: readonly DraftPin[],
): readonly ChoiceRow[] {
  return rows.map((row) => {
    const held = chosen.find((pin) => pin.questionId === row.questionId)?.version;
    if (held === row.version) {
      return { ...row, checked: true, choosable: true, state: t("forms.picker.stateChosen") };
    }
    if (held !== undefined) {
      return {
        ...row,
        checked: false,
        choosable: false,
        state: t("forms.picker.stateOtherVersionChosen", { version: held }),
      };
    }
    return { ...row, checked: false, choosable: row.pinnable };
  });
}

/**
 * Add a version to the chosen set, in the order it was chosen.
 *
 * Insertion order is the order the pins are inserted into the step, so it is the author's
 * order rather than the library's. Nothing else here has a claim to it: list order belongs
 * to the library, and the library's order is not a statement about this form.
 */
export function choose(chosen: readonly DraftPin[], pin: DraftPin): readonly DraftPin[] {
  return [...chosen.filter((entry) => entry.questionId !== pin.questionId), pin];
}

/**
 * Drop this question's chosen version, whichever it is.
 *
 * By question rather than by `questionId@version` because only one version of a question
 * can be in the set at a time, so the pair would be a precision the state cannot use, and
 * matching on it would leave the set unchanged in the one case where the two disagreed.
 */
export function unchoose(chosen: readonly DraftPin[], questionId: string): readonly DraftPin[] {
  return chosen.filter((pin) => pin.questionId !== questionId);
}

/**
 * The chosen pins with the label each one will carry, in the order they were chosen.
 *
 * Resolved against the whole library rather than the filtered rows on purpose: a chosen
 * version stays chosen when a later search hides its row, and the pane is precisely where
 * the author sees that it did. Driving it off the listed rows would empty the pane
 * whenever the search stopped matching, which reads as "the choice was dropped".
 *
 * A pin whose question has left the library between the read and the render falls out
 * rather than rendering a nameless entry, and the commit is driven off this list, so a pin
 * the author was never shown by name cannot be added either.
 */
export function chosenDetail(
  library: readonly PinnableQuestion[],
  chosen: readonly DraftPin[],
): readonly ChosenRow[] {
  const rows: ChosenRow[] = [];
  for (const pin of chosen) {
    const question = library.find((entry) => entry.questionId === pin.questionId);
    if (question === undefined) continue;
    rows.push({ ...pin, label: textOf(question.label ?? undefined) });
  }
  return rows;
}
