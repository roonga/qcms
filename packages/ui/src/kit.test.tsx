import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as kit from "./kit.ts";
import { axeViolations } from "./test-support/a11y.ts";

/**
 * A smoke test for the `@qcms/ui/kit` surface (task 031).
 *
 * Deliberately shallow, and the reason matters: these components are **vendored
 * upstream source** (ADR-22), so their behaviour and their component-level
 * accessibility are tested in `a2-react-aria`, and re-asserting that here would
 * duplicate a suite this repo does not own. Re-testing it would also be the wrong
 * pressure - it would make an upstream refinement look like a QCMS regression.
 *
 * What is genuinely ours, and therefore what this covers:
 *
 * 1. **The export list is real.** `kit.ts` is a hand-written barrel over paths that
 *    the a2ra CLI owns, so a rename upstream, a missed file, or a typo in a
 *    re-export is a QCMS defect. Every export is checked to be a callable
 *    component.
 * 2. **Each primitive renders at all, standalone.** `Breadcrumb` still has no consumer
 *    until tasks 033-035, so without this a broken vendoring would sit undetected for
 *    two tasks and then surface as someone else's bug. Rendering them once here is the
 *    cheapest possible tripwire.
 * 3. **No axe violations in their default rendering.** The admin's own axe gate runs
 *    in a real browser over real screens; this is the earlier, faster signal for a
 *    primitive nothing has wired up yet.
 *
 * `Dialog` is rendered in its trigger form (closed), which is its mounted state: the
 * open state is a react-aria overlay with layout behaviour that belongs in Playwright,
 * not jsdom (ADR-23).
 */

/** The primitives the admin kit promises, each with the minimal props it needs. */
const PRIMITIVES = [
  ["Alert", <kit.Alert variant="info">Something happened.</kit.Alert>],
  [
    "Breadcrumb",
    <kit.Breadcrumb
      ariaLabel="Breadcrumb"
      items={[
        { id: "forms", label: "Forms" },
        { id: "builder", label: "Builder" },
      ]}
    />,
  ],
  ["Button", <kit.Button variant="primary">Save</kit.Button>],
  ["Card", <kit.Card padding="md">Card body.</kit.Card>],
  ["Checkbox", <kit.Checkbox label="Required" name="required" />],
  ["DatePicker", <kit.DatePicker label="Earliest" name="min" />],
  ["Dialog", <kit.Dialog triggerLabel="Open" title="Confirm" description="Are you sure?" />],
  [
    "Form",
    <kit.Form>
      <kit.TextField label="Name" name="name" />
    </kit.Form>,
  ],
  // The vendored `Menu` renders its own trigger and stays closed until pressed, which
  // is its mounted state - the open popover is react-aria overlay layout and belongs in
  // Playwright (ADR-23), the same call `Dialog` above makes.
  [
    "Menu",
    <kit.Menu
      triggerLabel="Options"
      items={[
        { id: "publish", label: "Publish" },
        { id: "deprecate", label: "Deprecate" },
      ]}
    />,
  ],
  ["NumberField", <kit.NumberField label="Minimum" name="min" />],
  [
    "Select",
    <kit.Select
      label="Type"
      name="type"
      items={[
        { label: "Short text", value: "shortText" },
        { label: "Number", value: "number" },
      ]}
    />,
  ],
  [
    "Table",
    <kit.Table
      ariaLabel="Forms"
      columns={[
        { id: "slug", label: "Slug" },
        { id: "status", label: "Status" },
      ]}
      // `data`, keyed by column id - not `cells`. Getting this wrong is the exact
      // mistake this test exists to catch before task 035 hits it.
      rows={[{ id: "r1", data: { slug: "auto-quote", status: "published" } }]}
    />,
  ],
  ["Text", <kit.Text>Plain text.</kit.Text>],
  ["TextField", <kit.TextField label="Email" name="email" />],
] as const;

describe("@qcms/ui/kit surface", () => {
  it("exports exactly the admin kit primitives, all callable", () => {
    // Pinned rather than counted: a primitive silently disappearing from the barrel
    // would otherwise only show up as a build error in a later task.
    //
    // Only the plain function exports are listed. The menu primitives task 032 added
    // are re-exported react-aria-components, and most of them arrive as forwardRef or
    // context objects rather than functions, so they never reach this filter -
    // `MenuTrigger` and the vendored `Menu` are the two that do. That is a property of
    // how react-aria packages them, not a statement about which of them matter; the
    // whole set is exercised together in `menu-keyboard.test.tsx`.
    const exported = Object.entries(kit).filter(([, value]) => typeof value === "function");
    expect(new Set(exported.map(([name]) => name))).toEqual(
      new Set([
        "Alert",
        "Breadcrumb",
        "Button",
        "Card",
        "Checkbox",
        "DatePicker",
        "Dialog",
        "Form",
        "Menu",
        "MenuTrigger",
        "NumberField",
        "Select",
        "Table",
        "Text",
        "TextField",
      ]),
    );
  });

  it("exposes no A2UI document schema (those belong to the renderer, not the kit)", () => {
    // An admin screen must not be able to grow an A2UI document by reaching for a
    // schema here: `registryForSpecVersion` on the root export is the only door.
    const leaked = Object.keys(kit).filter((name) => name.endsWith("Schema"));
    expect(leaked).toEqual([]);
  });

  it.each(PRIMITIVES)("renders %s standalone", (_name, element) => {
    const { container } = render(element);
    expect(container.firstElementChild).not.toBeNull();
  });

  it.each(PRIMITIVES)("has zero axe violations for %s", async (_name, element) => {
    const { container } = render(element);
    expect(await axeViolations(container)).toEqual([]);
  });
});
