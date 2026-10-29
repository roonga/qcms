import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as kit from "./kit.ts";
import { axeViolations } from "./test-support/a11y.ts";

// Deliberately shallow: the components are vendored and tested upstream. What is ours is the barrel,
// hand-written over paths the a2ra CLI owns, so a rename upstream or a typo in a re-export is a QCMS defect.

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
  // Playwright (ADR-23).
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
      // `data`, keyed by column id, never `cells`.
      rows={[{ id: "r1", data: { slug: "auto-quote", status: "published" } }]}
    />,
  ],
  ["Text", <kit.Text>Plain text.</kit.Text>],
  ["TextField", <kit.TextField label="Email" name="email" />],
] as const;

describe("@roonga/qcms-ui/kit surface", () => {
  it("exports exactly the admin kit primitives, all callable", () => {
    // Pinned rather than counted, so a primitive disappearing from the barrel fails here. Only plain function
    // exports are listed; the re-exported react-aria-components primitives are mostly forwardRef or context
    // objects and never reach this filter.
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
    // `registryForSpecVersion` on the root export is the only door to the renderer.
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
