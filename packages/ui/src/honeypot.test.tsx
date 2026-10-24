import { render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";

// The axe pass rides on the conformance suite; this is the DOM shape and the absence
// from the accessibility tree.
const minimal = loadGoldenForms().find((f) => f.version === "v2" && f.form === "minimal");
if (!minimal) throw new Error("minimal v2 golden not found");
const step = minimal.compiled.documents[0];

describe("Honeypot decoy rendering (task 026 contract)", () => {
  it("renders an off-screen aria-hidden input under the well-known name", () => {
    const { container } = render(<A2UIStepRenderer document={step} />);
    const input = container.querySelector('input[name="website"]');
    expect(input).not.toBeNull();
    expect(input!.getAttribute("autocomplete")).toBe("off");
    expect(input!.getAttribute("tabindex")).toBe("-1");

    const wrapper = input!.parentElement!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    // jsdom's CSSOM drops the legacy `clip` property, so these stand in for it.
    expect(wrapper.style.position).toBe("absolute");
    expect(wrapper.style.overflow).toBe("hidden");
    expect(wrapper.style.width).toBe("1px");
    expect(wrapper.style.height).toBe("1px");
  });

  it("is invisible to assistive tech (no accessible name, not in the a11y tree)", () => {
    const { container } = render(<A2UIStepRenderer document={step} />);
    const input = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(computeAccessibleName(input)).toBe("");
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]).not.toBe(input);
  });
});
