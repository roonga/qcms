import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import type { DraftForm, DraftGroup, DraftStep, PinnableQuestion } from "../../lib/forms/types.ts";

/**
 * The group panel's two radio groups, and the one property a unit test can hold about them.
 *
 * ## Why this file exists
 *
 * The count source and the presentation are each a three-way choice where **every option changes
 * which other fields exist**, so all three options carry a sentence of their own and all three
 * have to be readable at once. `@roonga/qcms-ui/kit` has no radio, so `group-panel.tsx` composes
 * the platform one, on the precedent `library-picker.tsx` set for the same reason.
 *
 * The trap that comes with composing it is the accessible name. A `<label>` contributes its WHOLE
 * text content to the input it wraps, so a description inside the label leaks into the name: every
 * option then announces as its label followed by its own explanation, no two options can be told
 * apart by a speech-input user saying what they can see, and an exact-name lookup for one of them
 * matches nothing.
 *
 * **It shipped that way and the whole admin unit suite passed.** Only the browser walk caught it,
 * through one `exact: true` lookup, which is a one-assertion margin for a property this cheap to
 * state. So it is stated here: the description is outside the label, and the label's own text is
 * exactly the option's name.
 *
 * `renderToStaticMarkup` is the highest layer that can see this without a browser (ADR-23): the
 * relationship under test is between two elements in the markup, and the vendored kit renders for
 * real. What still needs a browser is whether the group reads as ONE tab stop with arrow-key
 * traversal inside it, which is the platform's behaviour rather than this markup's.
 */

const DEFINITION = {
  questionId: "q_passport",
  type: "shortText" as const,
  label: { en: "Passport number" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_passport",
    slug: "passport",
    label: { en: "Passport number" },
    type: "shortText",
    versions: [{ version: 1, status: "published", definition: DEFINITION }],
  },
];

const GROUP: DraftGroup = {
  groupId: "grp_passengers",
  label: { en: "Passengers" },
  instanceLabel: { en: "Passenger {n}" },
  items: [{ questionId: "q_passport", version: 1 }],
  count: { source: "open", min: 1, max: 9 },
  presentation: "stacked",
};

const STEP: DraftStep = {
  stepId: "stp_travellers",
  title: { en: "Travellers" },
  items: [GROUP],
};

const DRAFT: DraftForm = {
  formId: "frm_booking",
  defaultLocale: "en",
  title: { en: "Booking" },
  steps: [STEP],
  rules: [],
};

async function render(): Promise<string> {
  const { GroupPanel } = await import("./group-panel.tsx");
  return renderToStaticMarkup(
    <GroupPanel
      draft={DRAFT}
      step={STEP}
      group={GROUP}
      library={{ ok: true, data: LIBRARY }}
      issues={[]}
      onRename={() => undefined}
      onInstanceLabel={() => undefined}
      onCount={() => undefined}
      onPresentation={() => undefined}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
    />,
  );
}

/**
 * Every `<label>` of a choice group, as its own markup.
 *
 * Split rather than matched with a lazy `[\s\S]*?`, which the lint gate rejects for
 * super-linear backtracking and is right to: this runs over a whole rendered panel.
 */
const CHOICE_LABEL_OPEN = '<label class="qcms-choice__row"';

function choiceLabels(markup: string): readonly string[] {
  return (
    markup
      .split(CHOICE_LABEL_OPEN)
      .slice(1)
      // The delimiter goes back on, so each entry is well-formed markup and `textOf` has an opening
      // tag to strip rather than the tail of one.
      .map((piece) => CHOICE_LABEL_OPEN + piece.slice(0, piece.indexOf("</label>")))
  );
}

/** The text an element's markup paints, tags stripped. */
function textOf(markup: string): string {
  // `[^<>]` rather than `[^>]`: the two classes are the same here, and bounding both delimiters
  // is what makes the match unambiguous rather than merely correct in practice.
  return markup.replaceAll(/<[^<>]*>/g, "").trim();
}

/** The six option labels the panel renders, in the order the two groups list them. */
const OPTION_LABELS = [
  "Always the same number",
  "From an earlier answer",
  "The respondent adds and removes",
  "All instances on one page",
  "One page per instance",
  "A table",
];

/**
 * Warm the vendored kit before the first test, with room.
 *
 * The same cost `pin-grid-ownership.test.tsx` records for the same reason: importing the kit and
 * rendering it once is about 5s cold against milliseconds warm, which on this project's own
 * timeout is a coin flip for whichever test runs first. Paid here rather than charged to a test
 * that is not about it.
 */
beforeAll(async () => {
  await render();
}, 60_000);

describe("the group panel's choice groups", () => {
  it("names each option by its label alone, with the description outside the label", async () => {
    const markup = await render();
    const labels = choiceLabels(markup);

    expect(labels, "three count sources and three presentations").toHaveLength(6);
    // The label's whole text IS the option's name, because that is what the input wrapped by it
    // answers to. A description inside would appear here and in the accessible name with it.
    expect(labels.map(textOf)).toStrictEqual(OPTION_LABELS);
    for (const label of labels) {
      expect(label, "one radio per option").toContain('type="radio"');
      expect(label, "the description must not be inside the label").not.toContain(
        "qcms-choice__hint",
      );
    }
  });

  it("wires each description to its own option with `aria-describedby`", async () => {
    const markup = await render();

    // Outside the label it would otherwise be adjacent text a screen reader never associates with
    // the control. Each hint's id is the one its own radio points at. Matched on the choice
    // radios alone, because the panel's text fields carry descriptions of their own and a
    // document-wide count would be about those as much as about these.
    const described = [
      ...markup.matchAll(/class="qcms-choice__input"[^>]*aria-describedby="([^"]+)"/g),
    ].map((match) => match[1] ?? "");
    expect(described).toHaveLength(6);
    expect(new Set(described).size, "each option describes itself, not a shared sentence").toBe(6);
    for (const id of described) {
      expect(markup, `the hint ${id} its own option points at`).toContain(
        `id="${id}" class="qcms-choice__hint"`,
      );
    }
  });

  it("renders every option's sentence, so all three choices are readable at once", async () => {
    const markup = await render();

    // The reason this is a radio group rather than a `Select`: each option changes which other
    // fields exist, so the consequences cannot sit behind a popover.
    expect(markup).toContain("Every respondent answers this group exactly this many times");
    expect(markup).toContain("A number question earlier in the form decides");
    expect(markup).toContain("The respondent presses Add");
    expect(markup).toContain("Instances become rows");
  });
});
