import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps, type GoldenStep } from "./test-support/golden.ts";

// `en` and `en-US` render the same markup, and a genuinely different locale changes it, so the first claim
// cannot pass against a renderer that ignores the prop. Markup is normalized because React's `useId` values
// are minted per root.

const GENERATED_ID = /_r_[0-9a-z]+_/g;

// Mounting the vendored control tree is the expensive part, and the assertions ask for
// the same pairs repeatedly, so without this the corpus is rendered five times over and
// the comparison tests sit close to their timeout under a loaded parallel run.

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

// A step of plain text and checkboxes renders identically in every locale, which would
// make the contrast vacuous.

const LOCALE_SENSITIVE = STEPS.filter((step) => {
  const html = markup(step, "en");
  return html.includes('role="spinbutton"') || html.includes("data-type=");
});

// Measured rather than guessed: the slowest test here is 1.6s idle and 4.1s under
// heavy system load, which took it past the 5s default while passing on its own.
describe("the locale prop over the golden corpus", { timeout: 30_000 }, () => {
  it("loads a corpus with locale-sensitive controls in it", () => {
    expect(STEPS.length).toBeGreaterThan(10);
    expect(LOCALE_SENSITIVE.length).toBeGreaterThan(0);
  });

  it("renders en and en-US identically, for every step", () => {
    const differing = STEPS.filter((step) => markup(step, "en") !== markup(step, "en-US")).map(
      (step) => `${step.version}/${step.form}/${step.stepId}`,
    );
    expect(differing).toEqual([]);
  });

  it("renders a genuinely different locale differently, so the prop is load-bearing", () => {
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
