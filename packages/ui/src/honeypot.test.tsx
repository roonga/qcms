import { render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";

// The honeypot decoy contract (task 026): every v2 step ends with a Honeypot
// node the renderer must emit as a visually-hidden, AT-invisible input — no
// label, off-screen, aria-hidden, tabindex=-1. Its axe pass rides on the
// conformance suite (v2 documents all carry it); here we assert the DOM shape
// and its absence from the accessibility tree.
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
    // Off-screen and 1px/clipped (not display:none, so a naive bot still "sees"
    // it). jsdom's CSSOM drops the legacy `clip` property, so it is verified via
    // the reference contract (a2ui-mapping.md) rather than here; the size +
    // overflow + off-screen position asserted below already hide the input.
    expect(wrapper.style.position).toBe("absolute");
    expect(wrapper.style.overflow).toBe("hidden");
    expect(wrapper.style.width).toBe("1px");
    expect(wrapper.style.height).toBe("1px");
  });

  it("is invisible to assistive tech (no accessible name, not in the a11y tree)", () => {
    const { container } = render(<A2UIStepRenderer document={step} />);
    const input = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(computeAccessibleName(input)).toBe("");
    // The only textbox exposed to AT is the real question, never the decoy.
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]).not.toBe(input);
  });
});
