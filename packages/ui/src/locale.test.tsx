import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps, type GoldenStep } from "./test-support/golden.ts";

/**
 * The `locale` prop, measured over the golden corpus (issues #729, #906).
 *
 * Two surfaces hand this renderer a locale: the portal, for the respondent, and the
 * admin's three preview surfaces, for the author looking at what a respondent will get.
 * Both used to pass nothing and inherit this package's own `en-US` default, and both were
 * corrected to pass the tag their app declares (`en`). This file is the measurement those
 * two changes rest on, made where the corpus lives rather than asserted in a pull request
 * body that nothing re-runs.
 *
 * It makes two claims, and the second is what stops the first from being vacuous.
 *
 * 1. **`en` and `en-US` render the same markup, for every compiled step in the corpus.**
 *    That is what makes dropping the region subtag a seam correction rather than a change
 *    to what anyone sees. It is not obvious and it is not assumed: `en` and `en-US` are
 *    different CLDR lookups, and this asserts that for everything a compiled A2UI step
 *    contains they resolve the same date field shape, the same placeholders, the same
 *    number formatting and the same react-aria announcements.
 *
 * 2. **A locale that genuinely differs changes that markup.** Without this, claim 1 would
 *    also pass against a renderer that ignored the prop entirely, which is precisely the
 *    defect the two call-site changes were about. `de-DE` moves the `DateField`'s segment
 *    order and placeholders (`mm` first becomes `tt` first) and re-announces the
 *    `NumberField`'s stepper buttons, so the prop is shown to reach react-aria's
 *    `I18nProvider` rather than sitting inert.
 *
 * ## Why the markup is normalized before it is compared
 *
 * React's generated ids (`useId`) are minted per root and this file renders each document
 * several times in one process, so the raw `innerHTML` of two identical trees differs in
 * its `id`/`for`/`aria-labelledby` values and nothing else. Comparing raw markup would
 * therefore report every step as differing under every locale, which is a confound rather
 * than a finding: it was the first result this file's investigation produced. So the ids
 * are blanked and everything else - elements, classes, attributes, text - is compared
 * exactly.
 */

/** React's per-root generated ids, which carry no locale information. */
const GENERATED_ID = /_r_[0-9a-z]+_/g;

function markup(step: GoldenStep, locale: string): string {
  const view = render(
    <A2UIStepRenderer document={step.document} specVersion={step.specVersion} locale={locale} />,
  );
  const html = view.container.innerHTML.replaceAll(GENERATED_ID, "ID");
  view.unmount();
  return html;
}

const STEPS = loadGoldenSteps();

/**
 * The corpus steps that contain a control whose rendering a locale can move: a date field
 * (segment order, placeholders, calendar) or a number field (separators, stepper
 * announcements). Claim 2 is asserted on these, because a step of plain text and
 * checkboxes renders identically in every locale and would make the contrast vacuous.
 */
const LOCALE_SENSITIVE = STEPS.filter((step) => {
  const html = markup(step, "en");
  return html.includes('role="spinbutton"') || html.includes("data-type=");
});

describe("the locale prop over the golden corpus", () => {
  it("loads a corpus with locale-sensitive controls in it", () => {
    expect(STEPS.length).toBeGreaterThan(10);
    expect(LOCALE_SENSITIVE.length).toBeGreaterThan(0);
  });

  it("renders en and en-US identically, for every step", () => {
    // The measurement behind both call-site changes: the region subtag carries nothing
    // this renderer can express, so moving off `en-US` moved no pixel.
    const differing = STEPS.filter((step) => markup(step, "en") !== markup(step, "en-US")).map(
      (step) => `${step.version}/${step.form}/${step.stepId}`,
    );
    expect(differing).toEqual([]);
  });

  it("renders a genuinely different locale differently, so the prop is load-bearing", () => {
    // Without this, the assertion above would hold just as firmly for a renderer that
    // threw the prop away - which is the state both surfaces were in before they passed
    // one.
    const same = LOCALE_SENSITIVE.filter(
      (step) => markup(step, "en") === markup(step, "de-DE"),
    ).map((step) => `${step.version}/${step.form}/${step.stepId}`);
    expect(same).toEqual([]);
  });

  it("puts the date field's segments in the order the locale asks for", () => {
    // The concrete case, spelled out: `en` gives month/day/year and `de-DE` day/month/year,
    // and the portal harness types into a segmented date field key by key on the first of
    // those (`apps/portal/e2e/support/kitchen-sink.ts`).
    const dated = STEPS.find((step) => markup(step, "en").includes('data-type="month"'));
    expect(dated, "the corpus should contain a date question").toBeDefined();
    expect(segmentTypes(dated!, "en")).toEqual(["month", "literal", "day", "literal", "year"]);
    expect(segmentTypes(dated!, "en-US")).toEqual(segmentTypes(dated!, "en"));
    expect(segmentTypes(dated!, "de-DE")).toEqual(["day", "literal", "month", "literal", "year"]);
  });
});

/** The `data-type` of every date segment of the first date field in one step, in order. */
function segmentTypes(step: GoldenStep, locale: string): string[] {
  const view = render(
    <A2UIStepRenderer document={step.document} specVersion={step.specVersion} locale={locale} />,
  );
  const types = [...view.container.querySelectorAll("[data-type]")].map(
    (element) => element.getAttribute("data-type") ?? "",
  );
  view.unmount();
  return types;
}
