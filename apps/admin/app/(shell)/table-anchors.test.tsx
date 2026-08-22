import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FormListItem, FormVersionSummary, PinnableQuestion } from "../../lib/forms/types.ts";
import type { QuestionDefinitionView, QuestionListItem } from "../../lib/questions/types.ts";

/**
 * Issue 570: the four kit tables gain real anchors and `onRowAction` retires.
 *
 * `plan/admin-design-contracts.md` §2 (CONFIRMED 2026-08-20):
 *
 * > Row action: the row's identifying cell carries a real anchor (open-in-new-tab and
 * > no-JS work); whole-row `onRowAction` click is retired with the kit-table migration.
 * > [...] Compact width: every table states which columns drop at `--bp-compact` and
 * > resets its `min-width` there so the scroll container is the fallback, not the
 * > default experience.
 *
 * Issue 514 brought these four tables into the one `qcms-table` family visually and left
 * the navigation alone, because retiring a whole-row click handler is a behaviour change
 * with its own evidence to produce. This file is half of that evidence.
 *
 * ## Why this layer, and what it can and cannot prove
 *
 * `renderToStaticMarkup` IS the no-JavaScript render: it is the server HTML with no
 * hydration, no event handlers and no client bundle. So an anchor carrying a resolvable
 * `href` in this string is the no-JS claim itself rather than a proxy for it, and it is
 * also the open-in-new-tab claim, because middle-click and "open in new tab" are the
 * browser acting on that attribute. The same is true in the other direction: a whole-row
 * click handler leaves NOTHING in this string, which is exactly why the defect was
 * invisible to every test that shipped before this one.
 *
 * What this layer cannot see is a browser actually following the anchor with scripting
 * switched off, and a keyboard walking to it. Those are `apps/admin/e2e/table-anchors.pw.ts`
 * (ADR-23: e2e at the highest layer that exists for it), and what needs an eye is
 * `docs/gates/pr-570/`.
 *
 * ## The completion test, asserted rather than remembered
 *
 * `qcms-table--rowaction` was issue 514's in-code marker for exactly this set, and it is
 * deleted when the last site gains its anchor. The last block below scans the admin source
 * tree for both that class and for `onRowAction`, so the marker cannot come back and a
 * fifth table cannot quietly adopt the retired pattern.
 *
 * ## The alias bridge
 *
 * The admin app imports itself through `@/`, and the Vitest project resolves nothing for
 * it. Each factory below hands back the REAL module by its relative path rather than a
 * stub, because the markup these components emit is the whole subject: a stub shaped like
 * a table would only assert that the stub is shaped like a table.
 *
 * ## Red-first
 *
 * Measured against the pre-change components, recorded in `docs/gates/pr-570/red-first.txt`.
 */

/**
 * The kit is real except for `Dialog`, and the exception is not a convenience. A
 * react-aria `Modal` renders through a portal, which server rendering has nowhere to put,
 * so the real one emits an empty string and the picker's whole table would vanish from
 * the markup this file reads. `Button` stays real, because the picker's new per-row
 * control IS the subject and a stub button would only assert that the stub is a button.
 */
vi.mock("@/components/kit", async () => {
  const kit = await import("../../components/kit.tsx");
  return {
    ...kit,
    Dialog: ({ children }: { readonly children?: ReactNode }) => (
      <div data-testid="qcms-dialog-stub">{children}</div>
    ),
  };
});
vi.mock("@/components/empty-state", () => import("../../components/empty-state.tsx"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft.ts"));
vi.mock("@/lib/forms/types", () => import("../../lib/forms/types.ts"));
vi.mock("@/lib/forms/version-diff", () => import("../../lib/forms/version-diff.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/i18n/format", () => import("../../lib/i18n/format.ts"));
vi.mock("@/lib/questions/definition", () => import("../../lib/questions/definition.ts"));
vi.mock("@/lib/questions/types", () => import("../../lib/questions/types.ts"));
vi.mock("@/lib/read-state", () => import("../../lib/read-state.ts"));

const { QuestionsTable } = await import("../../components/questions/questions-table.tsx");
const { FormsTable } = await import("./forms/forms-table.tsx");
const { VersionHistory } = await import("../../components/forms/version-history.tsx");
const { LibraryPicker } = await import("../../components/forms/library-picker.tsx");

const QUESTIONS: readonly QuestionListItem[] = [
  {
    questionId: "q_alpha",
    slug: "alpha",
    createdAt: "2026-08-01T10:00:00.000Z",
    latestVersion: 3,
    latestStatus: "published",
    publishedAt: "2026-08-01T10:00:00.000Z",
    label: { en: "Alpha question" },
    type: "shortText",
  },
];

const FORMS: readonly FormListItem[] = [
  {
    formId: "frm_alpha",
    slug: "alpha-form",
    defaultLocale: "en",
    status: "open",
    hasDraft: true,
    latestVersion: 2,
    publishedAt: "2026-08-01T10:00:00.000Z",
  },
];

const VERSIONS: readonly FormVersionSummary[] = [
  {
    version: 2,
    publishedAt: "2026-08-02T10:00:00.000Z",
    compilerVersion: "1.2.3",
    a2uiSpecVersion: "0.9.0",
    semanticsVersion: "4",
  },
  {
    version: 1,
    publishedAt: "2026-08-01T10:00:00.000Z",
    compilerVersion: "1.2.2",
    a2uiSpecVersion: "0.9.0",
    semanticsVersion: "4",
  },
];

function definitionOf(version: number): QuestionDefinitionView {
  return {
    questionId: "q_free",
    type: "shortText",
    label: { en: `A pinnable question, v${String(version)}` },
  };
}

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_free",
    slug: "free",
    label: { en: "A pinnable question" },
    type: "shortText",
    versions: [
      { version: 1, status: "deprecated", definition: definitionOf(1) },
      { version: 2, status: "published", definition: definitionOf(2) },
    ],
  },
];

const EMPTY_DRAFT = { formId: "frm_alpha", locale: "en", steps: [], rules: [] };

/** The class issue 514 used to mark "this row is still the control". It retires here. */
const MARKER = "qcms-table--rowaction";

function questionsMarkup(): string {
  return renderToStaticMarkup(<QuestionsTable rows={QUESTIONS} />);
}

function formsMarkup(): string {
  return renderToStaticMarkup(<FormsTable rows={FORMS} />);
}

function historyMarkup(): string {
  return renderToStaticMarkup(
    <VersionHistory formId="frm_alpha" versions={VERSIONS} definitionsByVersion={{}} />,
  );
}

function pickerMarkup(): string {
  return renderToStaticMarkup(
    <LibraryPicker
      isOpen
      stepTitle="Step one"
      draft={EMPTY_DRAFT as never}
      library={{ ok: true, data: LIBRARY }}
      onPin={() => undefined}
      onClose={() => undefined}
    />,
  );
}

/**
 * The row-header cell of the row naming `id`, so an assertion cannot be satisfied by an
 * anchor that lives somewhere else on the screen. §2 asks for the anchor in the row's
 * IDENTIFYING cell, and a link list beside the table is precisely what it replaces.
 */
function rowHeaderCell(markup: string, id: string): string {
  const rows = markup.split("<tr");
  const row = rows.find((candidate) => candidate.includes(id));
  expect(row, `a row naming ${id}`).toBeDefined();
  const start = (row ?? "").indexOf("<th");
  const end = (row ?? "").indexOf("</th>", start);
  expect(start, `a row header cell in the row naming ${id}`).toBeGreaterThanOrEqual(0);
  return (row ?? "").slice(start, end);
}

describe("the question library table", () => {
  it("carries a real anchor in its identifying cell", () => {
    const cell = rowHeaderCell(questionsMarkup(), "q_alpha");
    expect(cell).toContain('href="/questions/q_alpha"');
    expect(cell).toMatch(/<a\b/);
  });

  it("names the destination on the anchor rather than repeating the bare id", () => {
    expect(questionsMarkup()).toContain('aria-label="Open question q_alpha"');
  });

  it("is a plain table, not a react-aria grid whose row is the control", () => {
    const markup = questionsMarkup();
    expect(markup).toMatch(/<table\b/);
    expect(markup).not.toContain('role="grid"');
    expect(markup).not.toContain(MARKER);
  });

  it("states which columns drop at compact width", () => {
    const markup = questionsMarkup();
    // Type and Created describe a row; ID, Label, Version and Status identify it or
    // decide what an author can do next. Version never drops anywhere.
    expect(markup).toContain('<th scope="col" class="qcms-cell--drop">Type</th>');
    expect(markup).toContain('<th scope="col" class="qcms-cell--num qcms-cell--drop">Created</th>');
    expect(markup).not.toMatch(/qcms-cell--drop[^>]*>Latest</);
  });
});

describe("the form library table", () => {
  it("carries a real anchor in its identifying cell", () => {
    const cell = rowHeaderCell(formsMarkup(), "alpha-form");
    expect(cell).toContain('href="/forms/frm_alpha"');
    expect(cell).toMatch(/<a\b/);
  });

  it("names the destination on the anchor", () => {
    expect(formsMarkup()).toContain('aria-label="Open form alpha-form"');
  });

  it("is a plain table, not a react-aria grid whose row is the control", () => {
    const markup = formsMarkup();
    expect(markup).toMatch(/<table\b/);
    expect(markup).not.toContain('role="grid"');
    expect(markup).not.toContain(MARKER);
  });

  it("states which columns drop at compact width", () => {
    const markup = formsMarkup();
    expect(markup).toContain('<th scope="col" class="qcms-cell--drop">Locale</th>');
    expect(markup).not.toMatch(/qcms-cell--drop[^>]*>Published</);
  });
});

describe("the version history table", () => {
  it("carries the view link in the Version cell of each row", () => {
    const markup = historyMarkup();
    expect(rowHeaderCell(markup, "v2")).toContain('href="/forms/frm_alpha/versions/2"');
    expect(rowHeaderCell(markup, "v1")).toContain('href="/forms/frm_alpha/versions/1"');
  });

  it("has folded the separate link list back into the rows", () => {
    expect(historyMarkup()).not.toContain("qcms-history-links");
  });

  it("drops the three engine stamps at compact width and never the version", () => {
    const markup = historyMarkup();
    expect(markup).toContain('<th scope="col" class="qcms-cell--drop">Compiler</th>');
    expect(markup).toContain('<th scope="col" class="qcms-cell--drop">A2UI spec</th>');
    expect(markup).toContain('<th scope="col" class="qcms-cell--drop">Semantics</th>');
    expect(markup).not.toMatch(/qcms-cell--drop[^>]*>Version</);
  });
});

describe("the library picker", () => {
  it("gives each choosable row its own named button rather than a clickable row", () => {
    const markup = pickerMarkup();
    expect(markup).not.toContain(MARKER);
    expect(markup).not.toContain('role="grid"');
    expect(markup).toContain("Add q_free version 2");
  });

  it("offers no control at all on a version that cannot be pinned", () => {
    const markup = pickerMarkup();
    // v1 is deprecated, so there is nothing to press and the State cell says why.
    expect(markup).not.toContain("Add q_free version 1");
    expect(markup).toContain("Deprecated");
  });

  it("states which columns drop at compact width", () => {
    expect(pickerMarkup()).toContain('<th scope="col" class="qcms-cell--drop">Type</th>');
  });
});

/**
 * Walk the admin source tree. `readdirSync` rather than a shell walk, because a
 * subprocess anywhere in this workspace has to resolve an absolute binary path or
 * `sonarjs/no-os-command-from-path` fails lint, and there is nothing here a shell does
 * better.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.(?:tsx?|css)$/.test(entry)) found.push(path);
  }
  return found;
}

describe("the marker class and the retired handler", () => {
  const here = fileURLToPath(import.meta.url);
  const adminRoot = join(here, "..", "..", "..");
  const files = sourceFiles(adminRoot).filter((path) => path !== here);

  /**
   * The USE of the handler, not the word. Several files here name `onRowAction` in prose
   * to record what retired and why, which is the point of writing it down; a scan that
   * could not tell the two apart would price that history at a failing gate. A prop can
   * only be passed, declared or called, so the discriminator is the character after the
   * name rather than the name itself.
   */
  const USE = /onRowAction\s*[=(:]/;

  it("finds no `onRowAction` passed, declared or called anywhere in the admin app", () => {
    const offenders = files.filter((path) => USE.test(readFileSync(path, "utf8")));
    expect(offenders.map((path) => path.slice(adminRoot.length + 1))).toEqual([]);
  });

  it("finds the marker class deleted, stylesheet included", () => {
    const offenders = files.filter((path) => readFileSync(path, "utf8").includes(MARKER));
    expect(offenders.map((path) => path.slice(adminRoot.length + 1))).toEqual([]);
  });
});
