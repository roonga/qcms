import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * switched off, and a keyboard walking to it. Those are covered by
 * `apps/admin/e2e/table-anchors.pw.ts`.
 *
 * ## The completion test, asserted rather than remembered
 *
 * `qcms-table--rowaction` was issue 514's in-code marker for exactly this set, and it is
 * deleted when the last site gains its anchor. The last block below scans the admin source
 * tree for both that class and for `onRowAction`, so the marker cannot come back and a
 * fifth table cannot quietly adopt the retired pattern.
 *
 * ## What is real and what is not
 *
 * The markup these components emit is the whole subject, so almost nothing is stubbed: a
 * stub shaped like a table would only assert that the stub is shaped like a table. The
 * one exception is spelled out below.
 */

/**
 * The kit is real except for `Dialog`, and the exception is not a convenience. A
 * react-aria `Modal` renders through a portal, which server rendering has nowhere to put,
 * so the real one emits an empty string and the picker's whole table would vanish from
 * the markup this file reads (issue 628). `Button` stays real, because the dialog's commit
 * control IS a kit button and a stub would only assert that the stub is a button.
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
      onAddPins={() => undefined}
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
  // Since issue 660 the row control is a CHECKBOX rather than the per-row button issue
  // 570 put here, and the reasoning that governed that choice is unchanged: a picker row
  // has no address, so it is not a link, and whatever control it carries has to be named
  // by the row it sits in. What multi-select changes is what the control does. The
  // assertions below therefore still refuse an anchor and still demand the named string.
  it("gives each choosable row its own named control rather than a clickable row", () => {
    const markup = pickerMarkup();
    expect(markup).not.toContain(MARKER);
    expect(markup).not.toContain('role="grid"');
    expect(markup).toContain('aria-label="Add q_free version 2"');
  });

  it("makes that control a checkbox, so its own state is part of what it announces", () => {
    const markup = pickerMarkup();
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*aria-label="Add q_free version 2"/);
  });

  it("offers no control at all on a version that cannot be pinned", () => {
    const markup = pickerMarkup();
    // v1 is deprecated, so there is nothing to tick and the State cell says why.
    expect(markup).not.toContain("Add q_free version 1");
    expect(markup).toContain("Deprecated");
  });

  it("names its commit control with the count, and cannot be pressed at zero", () => {
    const markup = pickerMarkup();
    // The static render is the zero state, which is the one case the plural rule does not
    // cover: "Add 0 questions to step" is a sentence no locale wants.
    expect(markup).toContain("Add questions to step");
    expect(markup).not.toContain("Add 0 questions");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Add questions to step/s);
  });

  it("shows the chosen pane before anything is chosen, with its running tally at zero", () => {
    const markup = pickerMarkup();
    expect(markup).toContain("Chosen (0)");
    expect(markup).toContain("Nothing chosen yet.");
  });

  it("states which columns drop at compact width", () => {
    expect(pickerMarkup()).toContain('<th scope="col" class="qcms-cell--drop">Type</th>');
  });
});

/**
 * Absolute git path: a bare `git` would trip `sonarjs/no-os-command-from-path`, which is
 * workspace-wide. Probing known locations and failing by name keeps the miss readable.
 */
const GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];

function gitBinary(): string {
  const found = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`no git binary at any of: ${GIT_CANDIDATES.join(", ")}`);
  }
  return found;
}

/**
 * The admin app's source files, as absolute paths: ask git, never walk the directory.
 *
 * Issue 629. The first version of this walked `readdirSync` from the app root and skipped
 * `node_modules` and `.next` by name. `next dev` writes to `.next-dev` (`.gitignore` line
 * 5, and the Playwright harness boots the dev server there), so in any checkout that had
 * run a dev server the walk read a *compiled copy* of `globals.css` and reported it as a
 * source offender. The failure was not flaky: it was a stable red for a lane that had run
 * the browser suite and a stable green on CI, which has no prior dev build. That is worse
 * than a flake, because both parties have a repeatable result and no reason to doubt it,
 * and the lane that hits it reads it as its own branch being broken.
 *
 * A longer skip list would not have fixed it, only postponed it: the next tool emits the
 * next name. The repository already maintains exactly one catalogue of what is generated
 * rather than authored, and it is `.gitignore` - which named `.next-dev` all along. So the
 * scan consults that catalogue through git instead of keeping a second, always-lagging
 * copy of it here. `--cached --others --exclude-standard` is tracked files plus files that
 * are new but not ignored, so a source file added and not yet staged is still scanned:
 * the set is "what this repository contains", not "what this working directory holds".
 *
 * A subprocess is the cost, which the walk was written to avoid. It buys a gate that
 * asserts a property of the repository rather than of the machine it runs on.
 */
function sourceFiles(root: string): string[] {
  const listed = execFileSync(
    gitBinary(),
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return listed
    .split("\0")
    .filter((path) => /\.(?:tsx?|css)$/.test(path))
    .map((path) => join(root, path))
    .filter((path) => existsSync(path));
}

describe("the marker class and the retired handler", () => {
  const here = fileURLToPath(import.meta.url);
  const adminRoot = join(here, "..", "..", "..");
  const files = sourceFiles(adminRoot).filter((path) => path !== here);

  /**
   * A scan that finds nothing passes both assertions below, so the enumeration has to be
   * shown to work before its emptiness means anything. A directory walk fails loudly when
   * it is pointed somewhere wrong; a subprocess can fail *open*, returning an empty list
   * from the wrong working directory. This is the guard against that, and it names two
   * files the scan must reach: the stylesheet the marker lived in, and one component.
   */
  it("reaches the admin sources it is meant to scan", () => {
    const relative = files.map((path) => path.slice(adminRoot.length + 1));
    expect(relative).toContain("app/globals.css");
    expect(relative).toContain("components/kit.tsx");
    expect(relative.length).toBeGreaterThan(100);
  });

  /**
   * The regression, made independent of the order the gates happened to run in. The
   * observation below it is the real-world one and only fires in a checkout that has
   * built; this plants the offending file itself, so the property is checked on CI and in
   * a fresh worktree too. `.next-dev` is where `next dev` writes (`.gitignore` line 5), so
   * a file placed there is ignored by exactly the rule that made the original failure
   * possible, and a scan that reads it has the bug however its skip list is spelled.
   */
  it("does not read a stylesheet a dev server left in the build directory", () => {
    const distDir = join(adminRoot, ".next-dev");
    const planted = join(distDir, "qcms-scan-probe.css");
    const distExisted = existsSync(distDir);
    try {
      mkdirSync(distDir, { recursive: true });
      writeFileSync(planted, `.${MARKER} { color: red; }\n`, "utf8");
      expect(sourceFiles(adminRoot)).not.toContain(planted);
    } finally {
      rmSync(planted, { force: true });
      if (!distExisted) rmSync(distDir, { force: true, recursive: true });
    }
  });

  /** And the same property as observed, on whatever this checkout happens to hold. */
  it("reads no build output this checkout already has on disk", () => {
    const generated = files.filter(
      (path) =>
        path.includes("/.next/") || path.includes("/.next-dev/") || path.endsWith("next-env.d.ts"),
    );
    expect(generated).toEqual([]);
  });

  /**
   * The USE of the handler, not the word. Several files here name `onRowAction` in prose
   * to record what retired and why, which is the point of writing it down; a scan that
   * could not tell the two apart would price that history at a failing gate. A prop can
   * only be passed, declared or called, so the discriminator is the character after the
   * name rather than the name itself.
   *
   * **Bounded on the left as well (issue #690).** Without it the pattern matched inside
   * an identifier: `OptionRowAction` is `Opti` + `onRowAction`, so the parallel name for
   * an option row's menu action tripped a guard about whole-row click navigation. That
   * cost a lane a forced test cycle and left a type in the tree named around this regex.
   * A source-text guard needs word boundaries on both sides, or it reports on identifiers
   * that merely contain its target.
   *
   * `_` and `$` are deliberately left OUT of the boundary class: they can start an
   * identifier, so `_onRowAction = ...` is the handler under a private-field spelling and
   * has to keep matching. Only a letter or a digit before the name means the match landed
   * inside a longer word.
   */
  const USE = /(?<![A-Za-z0-9])onRowAction\s*[=(:]/;

  /** What a lane meeting this guard needs to read: the rule, then the characters. */
  const RULE =
    "the retired whole-row click handler must not be passed, declared or called (issue 570)";

  it("finds no `onRowAction` passed, declared or called anywhere in the admin app", () => {
    const offenders = files.flatMap((path) => {
      const matched = USE.exec(readFileSync(path, "utf8"))?.[0];
      if (matched === undefined) return [];
      return [`${path.slice(adminRoot.length + 1)}: matched ${JSON.stringify(matched)} - ${RULE}`];
    });
    expect(offenders).toEqual([]);
  });

  /**
   * The guard's own discriminators, asserted rather than assumed. A scan derived from a
   * name is only as good as its boundaries, and both sides of that were wrong here at
   * some point: the right-hand one is what tells prose from a prop, the left-hand one is
   * what tells an unrelated identifier from the handler (issues 570 and 690).
   */
  it("tells the handler apart from prose and from an identifier that contains it", () => {
    expect(USE.test("onRowAction={handleRow}")).toBe(true);
    expect(USE.test("  onRowAction: (row) => void;")).toBe(true);
    expect(USE.test("onRowAction (row);")).toBe(true);
    // A private-field spelling is still the handler, which is why `_` is not a boundary.
    expect(USE.test("this._onRowAction = handler;")).toBe(true);
    expect(USE.test("// `onRowAction` retired with the whole-row click target")).toBe(false);
    expect(USE.test("export type OptionRowAction = 'moveUp';")).toBe(false);
    expect(USE.test("handleOptionRowAction(row);")).toBe(false);
  });

  it("finds the marker class deleted, stylesheet included", () => {
    const offenders = files.filter((path) => readFileSync(path, "utf8").includes(MARKER));
    expect(offenders.map((path) => path.slice(adminRoot.length + 1))).toEqual([]);
  });
});
