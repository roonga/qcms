import { describe, expect, it } from "vitest";

import { HONEYPOT_FIELD_NAME, HONEYPOT_NODE_TYPE, honeypotNode } from "./honeypot.js";
import type { A2UINode } from "./types.js";

/**
 * The decoy's contract and its accessibility properties. The live axe pass runs
 * against the real renderer; here the assertions are that the node carries the
 * hiding intent and that its documented reference rendering is invisible to
 * assistive technology.
 */

/**
 * The rendering the renderer must produce for a `Honeypot` node, kept here as an
 * executable spec of the contract in `docs/a2ui-mapping.md`.
 */
function renderHoneypotReference(node: A2UINode): string {
  const props = node.props ?? {};
  const name = String(props.name);
  const autoComplete = String(props.autoComplete);
  const tabIndex = String(props.tabIndex);
  const ariaHidden = props.ariaHidden === true ? "true" : "false";
  const offScreen =
    "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
  return (
    `<div aria-hidden="${ariaHidden}" style="${offScreen}">` +
    `<input name="${name}" autocomplete="${autoComplete}" tabindex="${tabIndex}" />` +
    `</div>`
  );
}

describe("honeypot node contract (exit criterion 2)", () => {
  it("submits under the shared, non-question field name", () => {
    // The API reads this same key off the submit body, and the name must never
    // look like a question id (R6), or it could collide with a real control.
    expect(HONEYPOT_FIELD_NAME).toBe("website");
    expect(HONEYPOT_FIELD_NAME.startsWith("q_")).toBe(false);
    expect(honeypotNode().props?.name).toBe(HONEYPOT_FIELD_NAME);
  });

  it("is a dedicated, unmistakable node type carrying the hiding props", () => {
    const node = honeypotNode();
    expect(node.type).toBe(HONEYPOT_NODE_TYPE);
    expect(node.type).toBe("Honeypot");
    expect(node.props).toEqual({
      name: "website",
      autoComplete: "off",
      ariaHidden: true,
      tabIndex: -1,
    });
    // No children and no value, and the same node every time.
    expect(node.children).toBeUndefined();
    expect(honeypotNode()).toEqual(honeypotNode());
  });
});

describe("honeypot is invisible to assistive tech (exit criterion 5)", () => {
  const html = renderHoneypotReference(honeypotNode());

  it("is aria-hidden - excluded from the accessibility tree", () => {
    expect(html).toContain('aria-hidden="true"');
  });

  it("is positioned off-screen (not visible to sighted users)", () => {
    expect(html).toMatch(/position:absolute/);
    expect(html).toMatch(/clip:rect\(0 0 0 0\)/);
  });

  it("is outside the tab order and never autofilled", () => {
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('autocomplete="off"');
  });

  it("is not a labelled field (no <label>, no accessible name)", () => {
    expect(html).not.toContain("<label");
    expect(html).not.toContain("aria-label");
    // The node exposes no prop the renderer could name it by either.
    expect(honeypotNode().props).not.toHaveProperty("label");
    expect(honeypotNode().props).not.toHaveProperty("description");
    expect(honeypotNode().props).not.toHaveProperty("aria-label");
  });
});
