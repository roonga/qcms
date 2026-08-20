import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, DraftStep, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";

/**
 * The pin list's OWNERSHIP CONTRAST, pinned structurally (issue 517).
 *
 * `plan/admin-ux-audit.md` §8 item 5 calls the step editor's pin list the highest-value
 * design change in the admin redesign, and the whole of its value is one property:
 *
 * > Editable (form-owned) cells read as controls; library-owned cells read as plain text.
 *
 * A screenshot cannot hold that property. Someone dropping an inline "rename" affordance
 * into the label cell next year would produce a frame that still looks like a tidy table,
 * and the thing the redesign bought would be gone. So the split is stated in the markup
 * (`data-owner` on every cell) and asserted here: a library-owned cell may hold nothing
 * that could change its value, and every form-owned cell must hold a control.
 *
 * The one button a library-owned cell may hold is the copy affordance
 * `plan/admin-design-contracts.md` §2 requires of an identifying column, and it has to
 * say so in the markup (`data-readonly-action`) rather than being spotted by name. This
 * file also asserts §2's other two clauses about that column: the id is rendered WHOLE
 * with no ellipsis anywhere, and the copy control's accessible name carries the entity
 * and the value rather than a bare "Copy".
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole table at once,
 * including the two cells that DROP at compact width, without booting a browser (ADR-23:
 * the highest layer that exists for it). What needs a browser - keyboard reorder, the
 * menu's five entries while it is open, the version pin still being operable at 390 - is
 * `apps/admin/e2e/pin-grid.pw.ts`, and what needs an eye is `docs/gates/pr-517/`.
 *
 * ## The alias bridge
 *
 * The admin app imports itself through the `@/` alias, and the Vitest project has no
 * resolver for it: this app's existing component tests all mock every `@/` import away.
 * These factories are not stubs - each hands back the real module by its relative path -
 * so what renders below is the real component tree, including the vendored kit.
 *
 * ## Red-first
 *
 * Against the pre-change component (kept beside this file as `.repro.tsx` while it was
 * being written): every assertion here fails. There is no `qcms-table` wrapper and no
 * `<table>` at all (the list was a `<ul>` of flex rows), no `data-owner` anywhere, no
 * copy control, and three of the five row controls were plain trailing buttons.
 */

vi.mock("@/components/kit", () => import("../kit.tsx"));
vi.mock("@/components/empty-state", () => import("../empty-state.tsx"));
vi.mock("@/components/row-menu", () => import("../row-menu.tsx"));
vi.mock("@/lib/announce", () => import("../../lib/announce.ts"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft.ts"));
vi.mock("@/lib/forms/issues", () => import("../../lib/forms/issues.ts"));
vi.mock("@/lib/forms/pin-grid", () => import("../../lib/forms/pin-grid.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/questions/definition", () => import("../../lib/questions/definition.ts"));

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 2, status: "published", definition: DEFINITION },
    ],
  },
  {
    questionId: "q_accident_count",
    slug: "accident-count",
    label: { en: "How many accidents?" },
    type: "number",
    versions: [{ version: 2, status: "published", definition: { ...DEFINITION, type: "number" } }],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [
    { questionId: "q_at_fault_accident", version: 1 },
    { questionId: "q_accident_count", version: 2 },
  ],
};

const DRAFT: DraftForm = {
  formId: "frm_vehicle_insurance",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

async function render(step: DraftStep, issues: readonly FormIssue[] = []): Promise<string> {
  const { StepEditor } = await import("./step-editor.tsx");
  return renderToStaticMarkup(
    <StepEditor
      draft={DRAFT}
      step={step}
      library={LIBRARY}
      issues={issues}
      onAddPin={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
    />,
  );
}

/** Every `<td>`/`<th>` of the rendered markup, as its attributes and its contents. */
function cells(html: string): { attrs: string; inner: string }[] {
  const found: { attrs: string; inner: string }[] = [];
  const pattern = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match = pattern.exec(html);
  while (match !== null) {
    found.push({ attrs: match[2] ?? "", inner: match[3] ?? "" });
    match = pattern.exec(html);
  }
  return found;
}

function cellsOwnedBy(html: string, owner: string): { attrs: string; inner: string }[] {
  return cells(html).filter((cell) => cell.attrs.includes(`data-owner="${owner}"`));
}

/** Anything that offers to CHANGE the value in the cell it sits in. */
const VALUE_CONTROL = /<(?:input|select|textarea)\b|aria-haspopup=/;

describe("the pin list is an ownership grid", () => {
  it("draws every form-owned cell as a control", async () => {
    const html = await render(STEP);
    const owned = cellsOwnedBy(html, "form");

    // Two per row: the grip (position) and the version trigger.
    expect(owned).toHaveLength(4);
    for (const cell of owned) {
      expect(cell.inner).toMatch(/<button\b/);
    }
  });

  it("draws every library-owned cell as text, with nothing in it that could change it", async () => {
    const html = await render(STEP);
    const owned = cellsOwnedBy(html, "library");

    // Three per row: the question identity, the type, the issues.
    expect(owned).toHaveLength(6);
    for (const cell of owned) {
      expect(cell.inner).not.toMatch(VALUE_CONTROL);
      // The only button a library-owned cell may hold is the copy affordance §2
      // requires, and it has to say so rather than be recognised by its markup.
      for (const button of cell.inner.match(/<button\b[^>]*>/g) ?? []) {
        expect(button).toContain('data-readonly-action="copy"');
      }
    }
  });

  it("gives every cell an owner, so the split cannot be half-applied", async () => {
    const html = await render(STEP);
    const body = html.slice(html.indexOf("<tbody"));

    for (const cell of cells(body)) {
      expect(cell.attrs).toMatch(/data-owner="(?:form|library)"/);
    }
  });
});

describe("the identifying column follows contract section 2", () => {
  it("renders the question id whole, in the row, and never truncated", async () => {
    const html = await render(STEP);

    expect(html).toContain("q_at_fault_accident");
    expect(html).toContain("q_accident_count");
    // An ellipsis, in either spelling. A truncation that looks like data invites
    // someone to copy a value that is not one, which is why §2 forbids it outright.
    expect(html).not.toContain("…");
    expect(html).not.toContain("text-overflow");
  });

  it("names the entity and the value on the copy control, not a bare 'Copy'", async () => {
    const html = await render(STEP);

    expect(html).toContain('aria-label="Copy question id q_at_fault_accident"');
    expect(html).toContain('aria-label="Copy question id q_accident_count"');
  });
});

describe("the pin list wears the table family", () => {
  it("is a plain table inside the qcms-table wrapper (contract section 2)", async () => {
    const html = await render(STEP);

    expect(html).toMatch(/<div class="qcms-table qcms-table--pins"><table>/);
    // No zebra, no private class on the table element: the family is the wrapper.
    expect(html).not.toMatch(/<table class=/);
  });

  it("states its compact-width drops on the cells that drop, and not on Version", async () => {
    const html = await render(STEP);
    const dropped = cells(html).filter((cell) => cell.attrs.includes("qcms-cell--drop"));

    // Type and Issues, header and both data rows: 2 columns x 3 rows.
    expect(dropped).toHaveLength(6);
    for (const cell of cells(html).filter((c) => c.attrs.includes("qcms-pincell--version"))) {
      expect(cell.attrs).not.toContain("qcms-cell--drop");
    }
  });

  it("renders the empty step as the one empty-state panel, not a bare paragraph", async () => {
    const html = await render({ ...STEP, items: [] });

    expect(html).toContain('data-testid="qcms-step-empty"');
    expect(html).toMatch(/<h2 class="qcms-empty__heading">/);
    expect(html).not.toContain("<table");
  });
});

describe("the row keeps its issue flag where the Issues column cannot follow", () => {
  it("marks the row itself, so a validation anchor still lands somewhere visible at 390", async () => {
    const issues: readonly FormIssue[] = [
      {
        code: "PIN_DEPRECATED",
        message: "Pinned to a deprecated version.",
        path: { question: "q_at_fault_accident" },
      },
    ];
    const html = await render(STEP, issues);

    expect(html).toMatch(
      /<tr class="qcms-pinrow is-error"[^>]*data-pin-question="q_at_fault_accident"/,
    );
    expect(html).toContain('data-issue-code="PIN_DEPRECATED"');
    // And the anchor the validation panel sends focus to is still in the row.
    expect(html).toContain('id="pin-q_at_fault_accident"');
  });
});
