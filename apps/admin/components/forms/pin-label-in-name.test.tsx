import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";

import type { DraftForm, DraftStep, PinnableQuestion } from "../../lib/forms/types.ts";

import { StepEditor } from "./step-editor.tsx";

/**
 * WCAG 2.5.3 label-in-name, for the step editor's own controls (issue #879).
 *
 * The criterion is one sentence: where a control carries visible text, that text is part
 * of its accessible name. The failure it exists for is not theoretical here. The pin's
 * version control paints `v3` and was named "Move pin for q_at_fault_accident", so the
 * two had no word in common: a speech-input user saying "click v3" moved nothing, and a
 * screen-reader user heard a name that no sighted colleague could point at. The row has
 * two other controls (the grip, the id's copy button) and both are icon-only, which is
 * why the gap could sit in the one control of the three that does show text.
 *
 * ## Why the assertion is a sweep rather than one string
 *
 * A test naming the version trigger alone would pin this instance and nothing else, and
 * the shape recurs by default: `kit.Menu` turns `triggerLabel` into an `aria-label`
 * whenever it is given alongside a `trigger`, and an `aria-label` REPLACES the content it
 * sits on in the name computation. So every button this component renders is checked, and
 * the rule is checked in the direction WCAG states it plus the stronger one speech input
 * actually needs: the name must START with the visible text, so the visible text is a
 * pronounceable prefix rather than a fragment buried mid-sentence.
 *
 * Controls that paint no text at all (an icon and nothing else) are outside the criterion
 * and are skipped - explicitly, and by reading the rendered tree rather than by listing
 * them here, so an icon that grows a caption later is swept in without anyone remembering
 * to add it.
 *
 * ## What counts as visible text: `aria-hidden` is not invisible
 *
 * `aria-hidden="true"` removes a subtree from the accessibility tree. It removes nothing
 * from the screen. Text inside it is still painted, a sighted operator still reads it, and
 * a speech-input operator still says it - which is precisely the shape of issue #1010,
 * where a button painted a person's initials inside an `aria-hidden` span and was named
 * something that did not contain them. So this file counts `aria-hidden` text as visible
 * text, and 2.5.3 applies to it. Treating it as invisible is what let #1010 exist.
 *
 * ## Why this layer
 *
 * The accessible name is computed from the rendered tree, so this needs a DOM: the
 * `name` option of a testing-library role query IS the computed name (dom-accessibility-api
 * under it), which is the same computation `getByRole` uses in Playwright. jsdom carries
 * no layout, and nothing here needs any (ADR-23): a name is not a measurement. The browser
 * gate that walks this control lives in `apps/admin/e2e/pin-grid.pw.ts`.
 */

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 3, status: "published", definition: DEFINITION },
    ],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [{ questionId: "q_at_fault_accident", version: 3 }],
};

const DRAFT: DraftForm = {
  formId: "frm_vehicle_insurance",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

function renderStep(): HTMLElement {
  return render(
    <StepEditor
      draft={DRAFT}
      step={STEP}
      library={{ ok: true, data: LIBRARY }}
      issues={[]}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
      onAddGroup={() => undefined}
      onOpenGroup={() => undefined}
      onMoveGroup={() => undefined}
      onRemoveGroup={() => undefined}
    />,
  ).container;
}

/**
 * Subtrees whose text is not painted. jsdom computes no layout and loads no stylesheet, so
 * "painted" is decided here by class and attribute, and the rule is:
 *
 * - `[hidden]` and an inline `display: none` / `visibility: hidden` remove a box, so their
 *   text is not painted.
 * - `.qcms-visually-hidden` is the repo's one clip-rect utility (`app/globals.css`). It is
 *   deliberately NOT `display: none`, because it exists to keep text in the accessibility
 *   tree while taking it off the screen, so its text is not painted either. Any equivalent
 *   utility a future stylesheet adds belongs in this list beside it.
 * - `aria-hidden="true"` is NOT in this list. It hides a subtree from assistive technology
 *   and from nothing else; its text is painted and 2.5.3 applies to it (issue #1010).
 *
 * What this cannot see: text hidden by a stylesheet rule rather than by one of the hooks
 * above (a class whose `display: none` lives only in CSS, a parent `overflow: hidden`, a
 * zero size, a transparent or same-colour fill), and text a `::before`/`::after` `content`
 * paints. A control hidden that way would be read here as painting text it does not paint,
 * which fails loudly rather than quietly; the browser gate is where real layout is judged.
 */
const UNPAINTED = ["[hidden]", ".qcms-visually-hidden"].join(",");

const DISPLAY_NONE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i;

/** A label a person could read aloud: at least one letter or digit somewhere in it. */
const SPEAKABLE = /[\p{L}\p{N}]/u;

function isUnpainted(element: Element): boolean {
  if (element.matches(UNPAINTED)) return true;
  const style = element.getAttribute("style");
  return style !== null && DISPLAY_NONE.test(style);
}

/**
 * Whether this subtree paints an icon rather than a label.
 *
 * 2.5.3 is about "labels that include text", and its whole point is that the operator can
 * say what they see. A glyph drawn with a character - `?`, a kebab `⋮`, an arrow - is an
 * icon that happens to be a codepoint, and there is nothing to say; an `svg` is the same
 * thing drawn differently. So a subtree whose painted characters contain no letter and no
 * digit is read here as an icon and contributes no visible text. Initials, a version like
 * `v3`, a count: all speakable, all kept, `aria-hidden` or not. The test is on the painted
 * characters, never on the markup, so nothing is excused by being wrapped in a span.
 */
function isIconOnly(element: Element): boolean {
  return !SPEAKABLE.test(element.textContent ?? "");
}

/**
 * What a sighted operator can read on the control: its painted text, minus the subtrees
 * that paint no box and the ones that paint an icon. See `UNPAINTED` and `isIconOnly`.
 */
function visibleText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const candidate of copy.querySelectorAll("*")) {
    if (isUnpainted(candidate) || isIconOnly(candidate)) candidate.remove();
  }
  const text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  // A glyph parented by the control itself rather than by a span of its own lands here.
  return SPEAKABLE.test(text) ? text : "";
}

/** `text` as a pattern matching an accessible name that begins with it. */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

describe("what the sweep counts as visible text", () => {
  // The sweep is only as good as this reading, and the reading is what issue #1010 got
  // wrong, so it is pinned here rather than left to whichever controls the step editor
  // happens to render today. If a control ever paints text inside an `aria-hidden` span,
  // the sweep above has to see it - and that is a property of this function alone.
  function textOf(html: string): string {
    const host = document.createElement("div");
    host.innerHTML = html;
    return visibleText(host);
  }

  it("counts text painted inside an aria-hidden subtree (issue #1010)", () => {
    expect(textOf(`<span aria-hidden="true">RM</span>`)).toBe("RM");
    expect(textOf(`<span aria-hidden="true">v3</span> <span>Move pin</span>`)).toBe("v3 Move pin");
  });

  it("does not count text that is genuinely not painted", () => {
    expect(textOf(`<span class="qcms-visually-hidden">Select Driving history</span>`)).toBe("");
    expect(textOf(`<span hidden>Draft</span>`)).toBe("");
    expect(textOf(`<span style="display: none">Draft</span>`)).toBe("");
    expect(textOf(`<span style="visibility:hidden">Draft</span>`)).toBe("");
  });

  it("does not count an icon, whether it is a glyph or an svg", () => {
    expect(textOf(`<span aria-hidden="true">⋮</span>`)).toBe("");
    expect(textOf(`<span aria-hidden="true">?</span>`)).toBe("");
    expect(textOf(`<svg aria-hidden="true"><path d="M1 1l4 4"></path></svg>`)).toBe("");
    // An icon beside a label leaves the label, and only the label, to compare against.
    expect(textOf(`<span>Add step</span><span aria-hidden="true">⋮</span>`)).toBe("Add step");
  });
});

describe("the step editor's controls satisfy label-in-name (WCAG 2.5.3)", () => {
  it("names the pin's version control with the version it displays", () => {
    const container = renderStep();
    const scope = within(container);

    // The visible text, from the catalog rather than typed out: this is the criterion's
    // "visible text", so reading it from anywhere else would let the two drift.
    const visible = t("forms.step.pinVersion", { version: 3 });
    const trigger = scope.getByRole("button", { name: startsWith(visible) });

    expect(visibleText(trigger)).toBe(visible);
    // And the name still says which pin it moves, which is why it carries a label at all:
    // "v3" alone repeats down a column of pins. A role query with a plain string matches
    // the WHOLE computed name, so this is the exact name and not a fragment of it.
    expect(
      scope.getByRole("button", {
        name: t("forms.step.movePin", { versionLabel: visible, questionId: "q_at_fault_accident" }),
      }),
    ).toBe(trigger);
  });

  it("starts every visible-text control's accessible name with that text", () => {
    const container = renderStep();
    const scope = within(container);
    const checked: string[] = [];

    for (const button of scope.getAllByRole("button")) {
      const visible = visibleText(button);
      // Paints no text: outside the criterion (an icon-only control is named by its
      // label alone). Asserted as a skip rather than a silent one. A control is skipped
      // only for painting nothing, never for wearing an `aria-hidden` on what it paints.
      if (visible === "") {
        expect(button.getAttribute("aria-label")).not.toBe(null);
        continue;
      }
      expect(scope.getAllByRole("button", { name: startsWith(visible) })).toContain(button);
      checked.push(visible);
    }

    // The sweep is only evidence while it has something to sweep: a rendering that
    // stopped showing text on any control would otherwise pass by finding nothing.
    expect(checked).toContain(t("forms.step.pinVersion", { version: 3 }));
  });
});
