import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as kit from "./kit.ts";
import { axeViolations } from "./test-support/a11y.ts";

/**
 * A smoke test for the `@roonga/qcms-ui/kit` surface.
 *
 * Deliberately shallow: these components are vendored upstream source (ADR-22), so
 * their behaviour and component-level accessibility are tested upstream, and
 * re-asserting it here would both duplicate a suite this repo does not own and make
 * an upstream refinement look like a QCMS regression.
 *
 * What is ours is the barrel itself, hand-written over paths the a2ra CLI owns, so a
 * rename upstream or a typo in a re-export is a QCMS defect. Each export is checked
 * to be a callable component, each primitive is rendered once as the cheapest
 * tripwire for a broken vendoring, and axe runs over the default rendering as the
 * earlier signal for a primitive nothing has wired up yet.
 *
 * `Dialog` is rendered closed, its mounted state: the open state is a react-aria
 * overlay whose layout behaviour belongs in Playwright (ADR-23).
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
  // Closed is its mounted state; the open popover is overlay layout and belongs in
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
      // `data`, keyed by column id, never `cells`: the mistake this test exists to
      // catch before a consumer hits it.
      rows={[{ id: "r1", data: { slug: "auto-quote", status: "published" } }]}
    />,
  ],
  ["Text", <kit.Text>Plain text.</kit.Text>],
  ["TextField", <kit.TextField label="Email" name="email" />],
] as const;

describe("@roonga/qcms-ui/kit surface", () => {
  it("exports exactly the admin kit primitives, all callable", () => {
    // Pinned rather than counted, so a primitive disappearing from the barrel fails
    // here rather than as a build error in a later change.
    //
    // Only the plain function exports are listed: the re-exported
    // react-aria-components primitives mostly arrive as forwardRef or context objects
    // and never reach this filter, which is a property of how react-aria packages
    // them. `I18nProvider` is the locale boundary rather than a primitive, so it is
    // listed here and not in the render matrix below.
    const exported = Object.entries(kit).filter(([, value]) => typeof value === "function");
    expect(new Set(exported.map(([name]) => name))).toEqual(
      new Set([
        "I18nProvider",
        "Alert",
        "Breadcrumb",
        "Button",
        "Card",
        "Checkbox",
        "DatePicker",
        "Dialog",
        "Form",
        "Menu",
        "NumberField",
        "Select",
        "Table",
        "Text",
        "TextField",
      ]),
    );
  });

  it("exposes no A2UI document schema (those belong to the renderer, not the kit)", () => {
    // An admin screen must not grow an A2UI document by reaching for a schema here:
    // `registryForSpecVersion` on the root export is the only door.
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
