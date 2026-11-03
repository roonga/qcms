import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import type { DraftForm, DraftGroup, DraftStep, PinnableQuestion } from "../../lib/forms/types.ts";

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

function parsed(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const OPTION_LABELS = [
  "Always the same number",
  "From an earlier answer",
  "The respondent adds and removes",
  "All instances on one page",
  "One page per instance",
  "A table",
];

beforeAll(async () => {
  await render();
}, 60_000);

describe("the group panel's choice groups", () => {
  it("names each option by its label alone, with the description outside the label", async () => {
    const document = parsed(await render());
    const labels = [...document.querySelectorAll("label.qcms-choice__row")];

    expect(labels, "three count sources and three presentations").toHaveLength(6);
    expect(labels.map((label) => label.textContent?.trim())).toStrictEqual(OPTION_LABELS);
    for (const label of labels) {
      expect(label.querySelector('input[type="radio"]'), "one radio per option").not.toBeNull();
      expect(
        label.querySelector(".qcms-choice__hint"),
        "the description must not be inside the label",
      ).toBeNull();
    }
  });

  it("wires each description to its own option with `aria-describedby`", async () => {
    const document = parsed(await render());
    const radios = [...document.querySelectorAll("input.qcms-choice__input")];

    expect(radios).toHaveLength(6);
    const described = radios.map((radio) => radio.getAttribute("aria-describedby") ?? "");
    expect(new Set(described).size, "each option describes itself, not a shared sentence").toBe(6);
    for (const id of described) {
      const hint = document.getElementById(id);
      expect(hint, `the hint ${id} its own option points at`).not.toBeNull();
      expect(hint?.className).toBe("qcms-choice__hint");
      expect(hint?.closest("label"), "and it is outside the label, not merely after it").toBeNull();
    }
  });

  it("renders every option's sentence, so all three choices are readable at once", async () => {
    const text = parsed(await render()).body.textContent ?? "";

    expect(text).toContain("Every respondent answers this group exactly this many times");
    expect(text).toContain("A number question earlier in the form decides");
    expect(text).toContain("The respondent presses Add");
    expect(text).toContain("Instances become rows");
  });
});
