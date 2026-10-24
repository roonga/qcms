import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import {
  actionColumnLabel,
  cellLabelFor,
  expandRepeatGroups,
  instanceNoun,
  qualifiedFieldName,
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_NODE_TYPE,
  ROSTER_OP_FIELD,
  totalLabelFor,
} from "./repeat/index.ts";
import { axeViolations } from "./test-support/a11y.ts";
import { loadGoldenForms } from "./test-support/golden.ts";
import { documentForVisible } from "./visible.ts";

/**
 * The table presentation in the renderer (ADR-43).
 *
 * What jsdom can prove: a native `<table>` with a caption, a `<th scope="col">` per
 * column and a `<th scope="row">` per row with no `role="grid"` anywhere; every cell
 * input's accessible name naming its row and its column, read from the accessibility
 * tree rather than the DOM; and the column total being neither an input nor posted.
 * Layout, focus-obscuring and axe on a filled table only exist rendered with real
 * layout, so they belong to the portal's browser suite.
 *
 * The document is the committed golden, so every shape asserted is one the compiler
 * emits rather than a hand-written approximation.
 */

const TABLE_FORM = "repeat-table-group";
const GROUP = "grp_vehicles";
const STEP = "stp_fleet_table";

/**
 * The columns, in the order the corpus form pins them, with the role each question
 * type's control takes in the accessibility tree.
 *
 * The roles are not all the same, which is why this table exists: react-aria names a
 * labelable control with a `<label for>` and a grouped one with a `<span>` wired by
 * `aria-labelledby`, because `<label for>` cannot name a group, and a number
 * question's visible control is a textbox rather than a spinbutton.
 */
const COLUMNS = [
  { questionId: "q_rep_plate", label: "Registration plate", role: "textbox" },
  { questionId: "q_rep_odometer", label: "Odometer reading", role: "textbox" },
  { questionId: "q_rep_service_date", label: "Last service date", role: "group" },
  { questionId: "q_rep_garaged", label: "Is this vehicle garaged overnight?", role: "radiogroup" },
  { questionId: "q_rep_use", label: "How is this vehicle used?", role: "radiogroup" },
] as const;

/**
 * The selector `theme-components.css` clips a cell's label and hint with, mirrored
 * here so the three things it must never reach are assertable. A drift test below
 * reads the sheet and refuses one that no longer carries it.
 */
const CLIP_SELECTOR = [
  ".qcms-repeat-table__cell [data-qcms-field] > * > :is(label, span, legend):first-child",
  '.qcms-repeat-table__cell [data-qcms-field] > * > [slot="description"]',
  ".qcms-repeat-table__cell [data-qcms-field] > * > [data-qcms-hint]",
].join(",");

/**
 * The component sheet, located by walking up from the cwd: the suite runs from the
 * repo root or from the package directory depending on how it was invoked, and
 * `import.meta.url` is not a file URL under this transform.
 */
function themeComponentsPath(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "packages", "ui", "src", "theme-components.css");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate packages/ui/src/theme-components.css from cwd");
}

function goldenStep(): { document: A2UIStepDocument; spec: string } {
  const golden = loadGoldenForms().find(
    (entry) => entry.version === "v4" && entry.form === TABLE_FORM,
  );
  if (golden === undefined) throw new Error(`no v4 golden for ${TABLE_FORM}`);
  const document = golden.compiled.documents.find((doc) => doc.stepId === STEP);
  if (document === undefined) throw new Error(`no step ${STEP} in ${TABLE_FORM}`);
  return { document, spec: golden.compiled.a2uiSpecVersion };
}

function instances(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `ins_t${String(index + 1)}`);
}

function renderTable(
  count: number,
  options: {
    readonly native?: boolean;
    readonly values?: Readonly<Record<string, unknown>>;
    readonly visible?: ReadonlySet<string>;
    readonly autofocusId?: string;
  } = {},
) {
  const { document, spec } = goldenStep();
  const roster = instances(count);
  const result = render(
    <A2UIStepRenderer
      document={
        options.visible === undefined
          ? document
          : documentForVisible(document, [...options.visible])
      }
      specVersion={spec}
      values={(options.values ?? {}) as never}
      repeat={{
        rosters: { [GROUP]: roster },
        opToken: "op_7f3",
        ...(options.visible === undefined ? {} : { visible: options.visible }),
        ...(options.autofocusId === undefined ? {} : { autofocusId: options.autofocusId }),
      }}
      {...(options.native === true
        ? { nativeSubmit: { action: "/s/ses_1/step", submitLabel: "Continue" } }
        : {})}
    />,
  );
  return { ...result, roster };
}

describe("the label and column strings", () => {
  it("names a cell row first, then column (APG: distinguishing words first)", () => {
    expect(cellLabelFor("Vehicle 3", "Odometer reading")).toBe("Vehicle 3, Odometer reading");
    // Degenerate inputs stay a single readable name rather than growing a comma.
    expect(cellLabelFor("", "Odometer reading")).toBe("Odometer reading");
    expect(cellLabelFor("Vehicle 3", "")).toBe("Vehicle 3");
  });

  it("names the row-header column for ONE instance, not the collection", () => {
    expect(instanceNoun("Vehicle {n}")).toBe("Vehicle");
    // A template with no placeholder is legal and is its own noun.
    expect(instanceNoun("The vehicle")).toBe("The vehicle");
    // Whitespace left by a removed `{n}` in the middle is collapsed.
    expect(instanceNoun("{n} of the fleet")).toBe("of the fleet");
  });

  it("names the actions column from the Remove lexicon, with no second source", () => {
    expect(actionColumnLabel("Remove {label}")).toBe("Remove");
  });

  it("falls back to English for a language the lexicon does not carry", () => {
    expect(totalLabelFor("en-AU")).toBe("Total");
    expect(totalLabelFor("cy")).toBe("Total");
  });
});

describe("the expansion produces one cell per column per row", () => {
  it("emits a RepeatTable whose rows carry a cell for every column", () => {
    const { document } = goldenStep();
    const roster = instances(3);
    const expanded = expandRepeatGroups(document.root, { rosters: { [GROUP]: roster } });
    const json = JSON.stringify(expanded);
    expect(json).toContain(`"${REPEAT_TABLE_NODE_TYPE}"`);
    expect(json).toContain(`"${REPEAT_ROW_NODE_TYPE}"`);
    // Three rows times five columns.
    expect(json.split(`"${REPEAT_CELL_NODE_TYPE}"`)).toHaveLength(3 * COLUMNS.length + 1);
    // The bare template name is gone: the qualified name is the field's whole
    // identity below the API.
    expect(json).not.toContain('"name":"q_rep_plate"');
    for (const instanceId of roster) {
      expect(json).toContain(`"${qualifiedFieldName(instanceId, "q_rep_plate")}"`);
    }
  });

  it("keeps the cell when a rule hides the question, and empties it", () => {
    // A per-instance rule can hide a member in one instance and not another, and a
    // table that dropped the cell would shear every later column off its header for
    // that row alone.
    const roster = instances(2);
    const visible = new Set([
      "q_rep_fleet_name",
      ...COLUMNS.map((column) => qualifiedFieldName(roster[0] ?? "", column.questionId)),
      ...COLUMNS.filter((column) => column.questionId !== "q_rep_odometer").map((column) =>
        qualifiedFieldName(roster[1] ?? "", column.questionId),
      ),
    ]);
    const { container } = renderTable(2, { visible });
    const rows = container.querySelectorAll<HTMLElement>("tbody tr");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The row header, one cell per column and the actions cell, whatever the rule
      // decided.
      expect(row.children).toHaveLength(COLUMNS.length + 2);
    }
    const hidden = rows[1]?.querySelector<HTMLElement>('td[data-qcms-column="q_rep_odometer"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.querySelector("input")).toBeNull();
    // The first row's odometer is still answerable.
    expect(
      rows[0]?.querySelector<HTMLElement>('td[data-qcms-column="q_rep_odometer"] input'),
    ).not.toBeNull();
  });

  it("is idempotent, so expanding an expanded tree changes nothing", () => {
    const { document } = goldenStep();
    const once = expandRepeatGroups(document.root, { rosters: { [GROUP]: instances(2) } });
    const twice = expandRepeatGroups(once, { rosters: { [GROUP]: instances(5) } });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("the native table structure (acceptance case 39)", () => {
  it("is a <table> with a caption, a column header per column and a row header per row", () => {
    const { container, roster } = renderTable(3);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent).toBe("Vehicles");

    const columnHeaders = [...container.querySelectorAll<HTMLElement>('thead th[scope="col"]')];
    // The corner cell names the row-header column, then one per member question, then
    // the actions column. The header's own text is its first node, because a column
    // carrying help text draws that under its label in a span of its own.
    expect(columnHeaders.map((th) => th.firstChild?.textContent)).toEqual([
      "Vehicle",
      ...COLUMNS.map((column) => column.label),
      "Remove",
    ]);

    const rowHeaders = [...container.querySelectorAll<HTMLElement>('tbody th[scope="row"]')];
    expect(rowHeaders.map((th) => th.textContent)).toEqual(["Vehicle 1", "Vehicle 2", "Vehicle 3"]);
    // The row header is the focus handle a roster operation lands on, either way.
    for (const [index, th] of rowHeaders.entries()) {
      expect(th.id).toBe(roster[index]);
      expect(th.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("carries no role=grid anywhere, asserted over the rendered DOM", () => {
    // Searched in the DOM rather than read off the source: the refusal is about what
    // reaches a respondent, and a vendored component could introduce the role without
    // this file mentioning it.
    const { container } = renderTable(3);
    expect(container.querySelectorAll('[role="grid"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="rowheader"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('role="grid"');
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(0);
    // And no roving tabindex, the other half of the refusal: the cells are not focus
    // stops and every cell's control stays in the page tab sequence. One tab stop per
    // cell is the documented cost of the ruled choice.
    const cells = [...container.querySelectorAll<HTMLElement>("td, th:not([scope='row'])")];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.hasAttribute("tabindex")).toBe(false);
    for (const input of container.querySelectorAll<HTMLElement>("td input[id]")) {
      expect(Number(input.getAttribute("tabindex") ?? "0")).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders the table and no instance card, and says no label twice", () => {
    const { container } = renderTable(2);
    expect(container.querySelectorAll("fieldset[data-qcms-instance]")).toHaveLength(0);
    // The caption is the only place the group's own label appears, so a heading above
    // it would say the collection's name twice.
    expect(screen.queryByRole("heading", { name: "Vehicles" })).toBeNull();
  });
});

describe("every cell input is named from the accessibility tree (acceptance case 40)", () => {
  it("names each control with its row and its column, at every column type", () => {
    // From the accessibility tree rather than the DOM: `computeAccessibleName` resolves
    // `<label for>` and `aria-labelledby`, so this is the name assistive technology
    // speaks rather than the markup that happens to carry it.
    const { container, roster } = renderTable(2);
    for (const [index, instanceId] of roster.entries()) {
      for (const column of COLUMNS) {
        const field = container.querySelector<HTMLElement>(
          `[data-qcms-field="${qualifiedFieldName(instanceId, column.questionId)}"]`,
        );
        expect(field, `${instanceId}/${column.questionId}`).not.toBeNull();
        const named = [...within(field!).queryAllByRole(column.role)]
          .map((element) => computeAccessibleName(element))
          .filter((name) => name.trim() !== "");
        expect(named[0], `${instanceId}/${column.questionId}`).toContain(
          `Vehicle ${String(index + 1)}, ${column.label}`,
        );
      }
    }
  });

  it("gives every cell a REAL label element, which is what survives the reflow", () => {
    // `scope` associates a cell with its header cells and is not claimed to name the
    // input, and the reflow removes the header cells altogether, so a real label per
    // cell is the only encoding that survives both layouts: present at this width too,
    // clipped by CSS rather than absent.
    const { container } = renderTable(1);
    for (const column of COLUMNS) {
      const cell = container.querySelector<HTMLElement>(
        `td[data-qcms-column="${column.questionId}"]`,
      );
      const clipped = [...(cell?.querySelectorAll<HTMLElement>(CLIP_SELECTOR) ?? [])];
      const names = clipped.map((element) => element.textContent ?? "");
      expect(
        names.some((text) => text.includes(`Vehicle 1, ${column.label}`)),
        `${column.questionId}: ${JSON.stringify(names)}`,
      ).toBe(true);
    }
  });

  it("clips the label and the hint, and NOTHING the respondent has to read", () => {
    // Three things the clip selector must never reach, each of which it did at some
    // point: an option's own label, a date segment, and a field error, whose clipping
    // would be a 3.3.1 failure.
    const { container } = renderTable(1);
    const clipped = [...container.querySelectorAll<HTMLElement>(CLIP_SELECTOR)];
    expect(clipped.length).toBeGreaterThan(0);
    for (const element of clipped) {
      expect(element.querySelector("input, select, textarea")).toBeNull();
      expect(element.getAttribute("role")).not.toBe("spinbutton");
      expect(element.querySelectorAll('[role="spinbutton"]')).toHaveLength(0);
      expect(element.getAttribute("slot")).not.toBe("errorMessage");
    }
    // The option labels stay painted, named in full.
    const useCell = container.querySelector<HTMLElement>('td[data-qcms-column="q_rep_use"]');
    const optionLabels = [...(useCell?.querySelectorAll("label") ?? [])].filter(
      (label) => label.querySelector("input") !== null,
    );
    expect(optionLabels.map((label) => label.textContent?.trim())).toEqual([
      "Private",
      "Business",
      "A mix of both",
    ]);
    for (const label of optionLabels) {
      expect(label.matches(CLIP_SELECTOR)).toBe(false);
    }
  });

  it("is the selector the stylesheet actually carries", () => {
    // The drift guard. The selector above is CSS mirrored into a test, so without this
    // the suite could keep passing against a sheet that had stopped clipping anything,
    // which is a table whose every cell shows its own label.
    const sheet = readFileSync(themeComponentsPath(), "utf8");
    for (const part of CLIP_SELECTOR.split(",")) {
      // The sheet prefixes every rule with the ADR-38 scope carrier and Prettier may
      // break a long selector across lines, so each part is compared whitespace-free.
      expect(sheet.replaceAll(/\s+/gu, "")).toContain(part.replaceAll(/\s+/gu, ""));
    }
  });

  it("puts a column's help text on its header, once, rather than in every cell", () => {
    const { container } = renderTable(3);
    const hint = container.querySelector<HTMLElement>(
      'thead th[data-qcms-column="q_rep_plate"] .qcms-repeat-table__colhint',
    );
    expect(hint?.textContent).toBe("As printed on the plate, without spaces");
    expect(container.querySelectorAll(".qcms-repeat-table__colhint")).toHaveLength(1);
    // Each input still carries its own description, so nothing left the tree.
    const described = container.querySelector<HTMLElement>(
      'td[data-qcms-column="q_rep_plate"] input',
    );
    expect(described?.getAttribute("aria-describedby")).not.toBeNull();
  });
});

describe("the <tfoot> column total is presentation only (acceptance case 43)", () => {
  function totalCellFor(container: HTMLElement, questionId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`tfoot td[data-qcms-column="${questionId}"]`);
  }

  it("totals the numeric column and nothing else", () => {
    const roster = instances(3);
    const { container } = renderTable(3, {
      values: {
        [qualifiedFieldName(roster[0] ?? "", "q_rep_odometer")]: 1200,
        [qualifiedFieldName(roster[1] ?? "", "q_rep_odometer")]: 340,
        [qualifiedFieldName(roster[2] ?? "", "q_rep_plate")]: "ABC123",
      },
    });
    expect(container.querySelector("tfoot th")?.textContent).toBe("Total");
    expect(totalCellFor(container, "q_rep_odometer")?.textContent).toContain("1,540");
    // A text column has nothing to total, and an empty cell says so.
    expect(totalCellFor(container, "q_rep_plate")?.textContent).toBe("");
  });

  it("is never an input, so it cannot be posted, stored or submitted", () => {
    const roster = instances(2);
    const { container } = renderTable(2, {
      native: true,
      values: { [qualifiedFieldName(roster[0] ?? "", "q_rep_odometer")]: 10 },
    });
    const foot = container.querySelector("tfoot");
    expect(foot).not.toBeNull();
    expect(foot?.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
    // And no field wrapper, so nothing downstream keys on it: the portal's decoder,
    // commit moments and error summary all walk `[data-qcms-field]`.
    expect(foot?.querySelectorAll("[data-qcms-field]")).toHaveLength(0);
    // The form's field set is the step's own questions plus the markers.
    const posted = [...container.querySelectorAll<HTMLInputElement>("form [name]")]
      .map((element) => element.getAttribute("name") ?? "")
      .filter((name) => !name.startsWith("__q") && name !== "website");
    expect(posted.some((name) => name.includes("total"))).toBe(false);
  });

  it("draws no footer at all when no column is numeric", () => {
    // An empty total row of blank cells is a row a respondent reads past for nothing.
    const visible = new Set([
      "q_rep_fleet_name",
      ...instances(1).flatMap((instanceId) =>
        COLUMNS.filter((column) => column.questionId !== "q_rep_odometer").map((column) =>
          qualifiedFieldName(instanceId, column.questionId),
        ),
      ),
    ]);
    const { container } = renderTable(1, { visible });
    expect(container.querySelector("tfoot")).toBeNull();
  });
});

describe("the per-row Remove rides task 073's mechanism unchanged", () => {
  it("is a named __qop submit button carrying formnovalidate without scripting", () => {
    const { container, roster } = renderTable(2, { native: true });
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-qcms-repeat-action="remove"]'),
    ];
    expect(buttons).toHaveLength(2);
    for (const [index, button] of buttons.entries()) {
      expect(button.name).toBe(ROSTER_OP_FIELD);
      expect(button.value).toBe(`remove:${GROUP}:${roster[index] ?? ""}:op_7f3`);
      expect(button.type).toBe("submit");
      expect(button.formNoValidate).toBe(true);
      // APG's naming practice puts the distinguishing words first.
      expect(button.textContent).toBe(`Remove Vehicle ${String(index + 1)}`);
    }
    // At most one `__qop` entry reaches the server, because only the pressed button
    // contributes its pair.
    expect(buttons.every((button) => button.name === ROSTER_OP_FIELD)).toBe(true);
  });

  it("shares the stacked presentation's button class, which is where the 44px floor is", () => {
    // A per-row Remove is the control most likely to fall below the 2.5.8 target-size
    // floor. It does not, because the floor is one declaration for both presentations
    // rather than two that can drift. The measurement is in the browser suite.
    const { container } = renderTable(1, { native: true });
    const button = container.querySelector<HTMLElement>('[data-qcms-repeat-action="remove"]');
    expect(button?.className).toContain("qcms-repeat__button");
  });

  it("lands autofocus on the row header the operation named, and on nothing else", () => {
    // The server's markup, because that is what the no-JS landing is: on the client
    // React applies `autoFocus` by calling focus() and writes no attribute, so a client
    // render of a correctly wired tree has zero `[autofocus]` elements.
    const roster = instances(3);
    const second = roster[1] ?? "";
    const { document: doc, spec } = goldenStep();
    const markup = renderToStaticMarkup(
      <A2UIStepRenderer
        document={doc}
        specVersion={spec}
        nativeSubmit={{ action: "/s/ses_1/step", submitLabel: "Continue" }}
        repeat={{ rosters: { [GROUP]: roster }, opToken: "op_7f3", autofocusId: second }}
      />,
    );
    const marked: string[] = [];
    for (const fragment of markup.split("<")) {
      const tag = fragment.split(">")[0] ?? "";
      if (!/^[a-z][a-z0-9]*[ /]/.test(tag)) continue;
      if (/ autofocus[ =]/.test(tag) || tag.endsWith(" autofocus")) marked.push(`<${tag}>`);
    }
    // Two `autofocus` targets leave which one wins to the browser, and the flush
    // algorithm skips it outright when the document has a fragment target, so the
    // landing has to be the only claim on the page.
    expect(marked).toHaveLength(1);
    const tag = marked[0] ?? "";
    expect(tag.startsWith("<th")).toBe(true);
    expect(tag).toContain(`id="${second}"`);
    expect(tag).toContain('scope="row"');
  });
});

describe("axe on a filled table (the jsdom half of case 45)", () => {
  it("reports no WCAG A or AA violation", async () => {
    const roster = instances(3);
    const { container } = renderTable(3, {
      values: {
        [qualifiedFieldName(roster[0] ?? "", "q_rep_plate")]: "ABC123",
        [qualifiedFieldName(roster[0] ?? "", "q_rep_odometer")]: 1200,
        [qualifiedFieldName(roster[1] ?? "", "q_rep_odometer")]: 900,
      },
    });
    const violations = await axeViolations(container);
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });

  it("reports no violation without scripting either", async () => {
    const { container } = renderTable(2, { native: true });
    const violations = await axeViolations(container);
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
});
