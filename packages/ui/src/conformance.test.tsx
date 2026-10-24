import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { a11yOutline, axeViolations } from "./test-support/a11y.ts";
import { loadGoldenForms, loadGoldenSteps } from "./test-support/golden.ts";

// Cases are generated from the append-only corpus, so a new golden file or generation
// is covered automatically (ADR-18).
const steps = loadGoldenSteps();
const cases = steps.map((step) => [`${step.version}/${step.form}/${step.stepId}`, step] as const);

// Read from the corpus rather than written down: the property worth pinning is that
// the loader picked up all of them, not which ones exist.
const generations = loadGoldenForms().map((form) => form.version);

describe("A2UIStepRenderer conformance over the golden corpus", () => {
  it("covers every generation present in the corpus, and there is more than one", () => {
    expect(steps.length).toBeGreaterThan(0);
    const covered = new Set(steps.map((s) => s.version));
    expect(covered).toEqual(new Set(generations));
    expect(covered.size).toBeGreaterThan(1);
  });

  it.each(cases)("renders %s and matches its accessibility tree", (_label, step) => {
    const { container } = render(
      <A2UIStepRenderer document={step.document} specVersion={step.specVersion} />,
    );
    expect(a11yOutline(container)).toMatchSnapshot();
  });

  it.each(cases)("has zero axe violations for %s", async (_label, step) => {
    const { container } = render(
      <A2UIStepRenderer document={step.document} specVersion={step.specVersion} />,
    );
    const violations = await axeViolations(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
