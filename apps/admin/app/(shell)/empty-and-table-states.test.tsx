import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue 514: one table family and one empty state.
 *
 * `plan/admin-design-contracts.md` §2 and §3 (CONFIRMED 2026-08-20) replace three table
 * treatments and two empty-state treatments with one of each. Most of that change is
 * visual and is evidenced by the committed capture under `docs/gates/pr-514/`. Three
 * parts of it are STRUCTURAL, which is what this file pins, so a later edit cannot
 * quietly put a screen back into its own private shape:
 *
 * 1. The empty state is the panel - a `qcms-empty` element containing an `h2` - and not
 *    a bordered `Card` (the two library screens) or a bare muted paragraph (the seven
 *    others).
 * 2. A table is a plain `<table>` inside a `qcms-table` wrapper. Neither of the retired
 *    hand-authored class names may reappear on either element.
 * 3. A failed read renders its alert and NOTHING else: no table, no panel, and above all
 *    no "there are none" sentence about data the app did not manage to read (§3, issue
 *    513's rule). The erasure log broke this one, and it is the screen where breaking it
 *    matters most - it answers "was this subject request honoured?".
 *
 * ## Why this layer
 *
 * The same reason `forms-list-states.test.tsx` gives, and this file is the sibling that
 * note anticipated when it left "the design of the zero state" to this issue. These are
 * server components whose reads run in the Next server process, so `page.route()` cannot
 * reach them and no browser gesture makes `listErasures` fail. Rendering the page
 * component with its read stubbed and asserting over the HTML it actually emits is the
 * highest layer that can see the failure branch at all (ADR-23's "highest layer that
 * exists for it"). The family's computed appearance - 44px rows, the header underline,
 * the absence of zebra - is a stylesheet question and belongs to the capture spec.
 *
 * ## Red-first
 *
 * Against the pre-change JSX: the empty-panel assertions fail on all three screens (the
 * markup carries `qcms-card`/`text-sm text-(--color-text-muted)` and no `qcms-empty`),
 * the wrapper assertions fail on the erasure table (`<table class="qcms-ops-table">`,
 * no wrapper), and the erasure failure-branch test fails on the "no empty claim"
 * assertion, because `rows` fell back to `[]` and the screen printed
 * `ops.erasures.empty` directly underneath the error alert.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** Set per test before the page module is imported; each page reads once, at render. */
let erasuresResult: unknown = { ok: true, data: [] };
let questionsResult: unknown = { ok: true, data: [] };
let formsResult: unknown = { ok: true, data: [] };

const ERASURE = {
  sessionId: "ses_one",
  formId: "frm_one",
  formVersion: 2,
  erasedAt: "2026-08-01T10:00:00.000Z",
  reason: "SUBJECT_REQUEST",
};

/**
 * The `@/` alias is a Next/tsconfig path and Vitest resolves nothing for it here (the
 * root config is deliberately the only one, task 001, and it declares no alias). Every
 * other file at this layer works around that by mocking each `@/` import away, which is
 * fine for a dependency whose behaviour is not the subject. `EmptyState` IS the subject,
 * so it is redirected to the real module by relative path rather than replaced: a stub
 * shaped like the panel would only assert that the stub is shaped like the panel. The
 * three `@/lib/questions/*` modules are pure helpers the question list needs, and get the
 * same treatment for the same reason - stubbing them would change what the page renders.
 */
vi.mock("@/components/empty-state", () => import("../../components/empty-state"));
vi.mock("@/lib/questions/definition", () => import("../../lib/questions/definition"));
vi.mock("@/lib/questions/errors", () => import("../../lib/questions/errors"));
vi.mock("@/lib/questions/types", () => import("../../lib/questions/types"));
vi.mock("@/lib/i18n/format", () => import("../../lib/i18n/format"));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/responses", () => ({
  listErasures: () => Promise.resolve(erasuresResult),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve(questionsResult),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
}));

/**
 * `t` answers with its own key, so every assertion below is about WHICH string a branch
 * chose rather than about the sentence it holds today. That is what lets the copy change
 * without this file noticing, and it is also what makes "the failed read does not print
 * the empty sentence" a precise claim rather than a substring guess.
 */
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

/** Marked stand-ins, so the real components' own markup never confuses the assertions. */
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Card: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-card-stub">{children}</div>
  ),
  Select: () => <select aria-label="stub" />,
  TextField: () => <input aria-label="stub" />,
}));
vi.mock("@/components/questions/questions-table", () => ({
  QuestionsTable: () => <div data-testid="qcms-questions-table-stub" />,
}));
vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));
vi.mock("./forms/create-form", () => ({
  CreateForm: () => <div data-testid="qcms-create-form-stub" />,
}));
vi.mock("./forms/actions", () => ({
  createFormAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/components/ops/ops-tags", () => ({
  erasureReasonText: (reason: string) => reason,
}));

/** The panel §3 prescribes, and the `h2` it must contain. */
const EMPTY_PANEL = /<div class="qcms-empty"[^>]*>/;
const EMPTY_HEADING = /<h2 class="qcms-empty__heading">/;

/** The two class names §2 retired. Neither may appear on any element, anywhere. */
const RETIRED_TABLE_CLASSES = /qcms-ops-table|qcms-links-table/;

async function renderErasures(): Promise<string> {
  const { default: Page } = await import("./responses/erasures/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderQuestions(searchParams: Record<string, string>): Promise<string> {
  const { default: Page } = await import("./questions/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function renderForms(): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page());
}

beforeEach(() => {
  erasuresResult = { ok: true, data: [] };
  questionsResult = { ok: true, data: [] };
  formsResult = { ok: true, data: [] };
});

describe("the erasure log's three states (issue 514)", () => {
  it("renders the alert and nothing else when the read fails", async () => {
    erasuresResult = { ok: false, message: "upstream said 503" };

    const html = await renderErasures();

    expect(html).toContain('data-testid="qcms-alert"');
    // No table, no panel, and no claim about how many erasures there are.
    expect(html).not.toMatch(/<table[\s>]/);
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).not.toContain("ops.erasures.empty");
    expect(html).not.toContain("ops.erasures.total");
  });

  it("renders the empty panel, and no table, when the log reads empty", async () => {
    const html = await renderErasures();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("ops.erasures.emptyTitle");
    expect(html).toContain("ops.erasures.empty");
    expect(html).not.toMatch(/<table[\s>]/);
    expect(html).not.toContain('data-testid="qcms-alert"');
  });

  it("renders one family table, wrapped, when the log has rows", async () => {
    erasuresResult = { ok: true, data: [ERASURE] };

    const html = await renderErasures();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).not.toMatch(RETIRED_TABLE_CLASSES);
    expect(html).not.toMatch(EMPTY_PANEL);
    // The droppable column and the stamp columns declare themselves in the markup, which
    // is what §2's compact-width and tabular-figures clauses are applied through.
    expect(html).toContain("qcms-cell--drop");
    expect(html).toContain("qcms-cell--num");
  });
});

describe("the library screens' empty state (issue 514)", () => {
  it("gives the question library the panel, with the creating action as its CTA", async () => {
    const html = await renderQuestions({});

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("questions.empty.title");
    expect(html).toContain("questions.empty.body");
    // §3's CTA, and the ONLY control on the screen offering it: the header link stands
    // down in this one state rather than repeating the panel's accessible name.
    expect(html.match(/href="\/questions\/new"/g)).toHaveLength(1);
  });

  it("swaps the heading and drops the sentence when the library is filtered", async () => {
    const html = await renderQuestions({ q: "nothing matches this" });

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toContain("questions.empty.filtered");
    // §3: the filtered variant keeps the panel and the clear-filters CTA, and drops the
    // explanatory sentence.
    expect(html).not.toContain("questions.empty.body");
    expect(html).toContain("questions.filter.clear");
    // A filtered library is not an empty one, so the header's creating action stays.
    expect(html).toContain('href="/questions/new"');
  });

  it("gives the form library the panel", async () => {
    const html = await renderForms();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("forms.empty.title");
    expect(html).toContain("forms.empty.body");
  });
});
