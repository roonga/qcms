import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { gitBinary } from "../../components/test-support/git-binary.ts";
import type { FormListItem, FormVersionSummary, PinnableQuestion } from "../../lib/forms/types.ts";
import type { QuestionDefinitionView, QuestionListItem } from "../../lib/questions/types.ts";

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
    publishedBy: null,
  },
  {
    version: 1,
    publishedAt: "2026-08-01T10:00:00.000Z",
    compilerVersion: "1.2.2",
    a2uiSpecVersion: "0.9.0",
    semanticsVersion: "4",
    publishedBy: null,
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
    expect(markup).not.toContain("Add q_free version 1");
    expect(markup).toContain("Deprecated");
  });

  it("names its commit control with the count, and cannot be pressed at zero", () => {
    const markup = pickerMarkup();
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

/* Read tracked files through git; walking the directory also scans build output and untracked files. */
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

  it("reaches the admin sources it is meant to scan", () => {
    const relative = files.map((path) =>
      path
        .slice(adminRoot.length + 1)
        .split(sep)
        .join("/"),
    );
    expect(relative).toContain("app/globals.css");
    expect(relative).toContain("components/kit.tsx");
    expect(relative.length).toBeGreaterThan(100);
  });

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

  it("reads no build output this checkout already has on disk", () => {
    const generated = files.filter(
      (path) =>
        path.includes("/.next/") || path.includes("/.next-dev/") || path.endsWith("next-env.d.ts"),
    );
    expect(generated).toEqual([]);
  });

  /* Bound the match on both sides so OptionRowAction cannot be mistaken for onRowAction. */
  const USE = /(?<![A-Za-z0-9])onRowAction\s*[=(:]/;

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

  it("tells the handler apart from prose and from an identifier that contains it", () => {
    expect(USE.test("onRowAction={handleRow}")).toBe(true);
    expect(USE.test("  onRowAction: (row) => void;")).toBe(true);
    expect(USE.test("onRowAction (row);")).toBe(true);
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
