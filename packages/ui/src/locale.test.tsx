import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps, type GoldenStep } from "./test-support/golden.ts";

/**
 * The `locale` prop, measured over the golden corpus.
 *
 * Two claims, and the second is what stops the first from being vacuous:
 *
 * 1. `en` and `en-US` render the same markup for every compiled step, which is what
 *    makes dropping the region subtag a seam correction rather than a change to what
 *    anyone sees. They are different CLDR lookups, so it is asserted rather than
 *    assumed.
 * 2. A locale that genuinely differs changes that markup. Without this, claim 1 would
 *    also pass against a renderer that ignored the prop entirely: `de-DE` moves the
 *    date field's segment order and placeholders and re-announces the number field's
 *    steppers, so the prop is shown to reach react-aria rather than sitting inert.
 *
 * The markup is normalized before it is compared because React's `useId` values are
 * minted per root and this file renders each document several times in one process, so
 * raw `innerHTML` differs in its id attributes and nothing else. The ids are blanked
 * and everything else is compared exactly.
 */

/** React's per-root generated ids, which carry no locale information. */
const GENERATED_ID = /_r_[0-9a-z]+_/g;

/**
 * One rendered step per (step, locale) pair, kept: mounting the whole vendored control
 * tree is the expensive part of this file and the assertions ask for the same pairs
 * repeatedly, so without the cache the corpus is rendered five times over and the
 * comparison tests sit close to their timeout under a loaded parallel run.
 */
const RENDERED = new Map<string, string>();

function markup(step: GoldenStep, locale: string): string {
  const key = `${step.version}/${step.form}/${step.stepId}@${locale}`;
  const cached = RENDERED.get(key);
  if (cached !== undefined) return cached;
  const view = render(
    <A2UIStepRenderer document={step.document} specVersion={step.specVersion} locale={locale} />,
  );
  const html = view.container.innerHTML.replaceAll(GENERATED_ID, "ID");
  view.unmount();
  RENDERED.set(key, html);
  return html;
}

const STEPS = loadGoldenSteps();

/**
 * The corpus steps holding a control whose rendering a locale can move: a date field or
 * a number field. Claim 2 is asserted on these, because a step of plain text and
 * checkboxes renders identically in every locale and would make the contrast vacuous.
 */
const LOCALE_SENSITIVE = STEPS.filter((step) => {
  const html = markup(step, "en");
  return html.includes('role="spinbutton"') || html.includes("data-type=");
});

// The same budget every corpus-wide suite in this package uses, and measured rather
// than guessed: the slowest test here is 1.6s idle and 4.1s under heavy system load,
// which is what took it past the 5s default while passing on its own.
describe("the locale prop over the golden corpus", { timeout: 30_000 }, () => {
  it("loads a corpus with locale-sensitive controls in it", () => {
    expect(STEPS.length).toBeGreaterThan(10);
    expect(LOCALE_SENSITIVE.length).toBeGreaterThan(0);
  });

  it("renders en and en-US identically, for every step", () => {
    // The region subtag carries nothing this renderer can express, so moving off
    // `en-US` moved no pixel.
    const differing = STEPS.filter((step) => markup(step, "en") !== markup(step, "en-US")).map(
      (step) => `${step.version}/${step.form}/${step.stepId}`,
    );
    expect(differing).toEqual([]);
  });

  it("renders a genuinely different locale differently, so the prop is load-bearing", () => {
    // Without this, the assertion above would hold just as firmly for a renderer that
    // threw the prop away.
    const same = LOCALE_SENSITIVE.filter(
      (step) => markup(step, "en") === markup(step, "de-DE"),
    ).map((step) => `${step.version}/${step.form}/${step.stepId}`);
    expect(same).toEqual([]);
  });

  it("puts the date field's segments in the order the locale asks for", () => {
    // `en` gives month/day/year and `de-DE` day/month/year, and the portal harness
    // types into a segmented date field key by key on the first of those.
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
