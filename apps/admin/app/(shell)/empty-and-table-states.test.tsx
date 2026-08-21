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
 * ## Issue 543: the same rule, on the screen where breaking it is worse still
 *
 * `/webhooks` handed `DeadLetters` an empty array on a failed read, so the queue printed
 * "nothing is stuck" - the reassuring answer, and a positive claim - directly beneath the
 * alert saying it could not be read. The queue now takes a `ReadState` (`lib/read-state.ts`)
 * and can tell "the read failed" from "the queue is clear". The three tests at the bottom
 * of this file pin all three of its states, and the middle one is the control: a genuinely
 * empty read must STILL get §3's panel, so the fix cannot degenerate into deleting the
 * empty state.
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
let deadLettersResult: unknown = { ok: true, data: [] };
let formDetailResult: unknown = { ok: true, data: undefined };
let responsesResult: unknown = { ok: true, data: undefined };

const DEAD_LETTER = {
  deliveryId: "dlv_one",
  eventId: "evt_one",
  eventType: "response.submitted",
  webhookId: "whk_one",
  formId: "frm_one",
  url: "https://example.test/hook",
  attempts: 5,
  lastError: "upstream said 500",
  deadLetteredAt: "2026-08-01T10:00:00.000Z",
};

const FORM_DETAIL = {
  formId: "frm_one",
  slug: "one",
  status: "published",
  versions: [{ version: 1 }],
};

const RESPONSE_ROW = {
  sessionId: "ses_one",
  formVersion: 1,
  submittedAt: "2026-08-01T10:00:00.000Z",
  accessMode: "anonymous",
  flaggedReason: null,
  answers: {},
};

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

/**
 * `DeadLetters` is the subject of the issue 543 block, so it too is redirected to the
 * real module rather than stubbed (`forms-list-states.test.tsx` stubs it for the opposite
 * reason: there the queue is noise around a form list). Its two non-render helpers are
 * stubbed, because neither runs during a static render and neither changes the markup:
 * `focusPostAction` is called from an effect, and `unexpected` only from a rejected
 * action's `catch`.
 */
vi.mock("@/components/ops/dead-letters", () => import("../../components/ops/dead-letters"));
vi.mock("@/lib/read-state", () => import("../../lib/read-state"));

/**
 * `ResponseBrowser` is the subject of the issue 521/572 block, so it is redirected to the
 * real module for the same reason `DeadLetters` is. Its three pure helpers go with it:
 * they compute page links, export choices and the answer preview, and stubbing them would
 * change the markup the assertions read.
 */
vi.mock("@/components/ops/response-browser", () => import("../../components/ops/response-browser"));
vi.mock("@/lib/ops/browse", () => import("../../lib/ops/browse"));
vi.mock("@/lib/ops/export", () => import("../../lib/ops/export"));
vi.mock("@/lib/ops/answers", () => import("../../lib/ops/answers"));
vi.mock("@/lib/ops/response-filters", () => import("../../lib/ops/response-filters"));
vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: () => <div data-testid="qcms-form-page-header-stub" />,
}));

/**
 * The response browser is a client component, so a static render reaches `useRouter`,
 * which throws outside an app-router context. Only the two members this tree touches are
 * provided: `notFound` keeps the page's own not-found branch throwing, as the real one
 * does.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/ops/post-action-focus", () => ({ focusPostAction: () => undefined }));
vi.mock("@/lib/ops/unexpected", () => ({ unexpected: () => "ops.error.unexpected" }));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/responses", () => ({
  listErasures: () => Promise.resolve(erasuresResult),
  listResponses: () => Promise.resolve(responsesResult),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve(questionsResult),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
  getForm: () => Promise.resolve(formDetailResult),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listDeadLetters: () => Promise.resolve(deadLettersResult),
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
  Dialog: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-dialog-stub">{children}</div>
  ),
  Select: () => <select aria-label="stub" />,
  TextField: () => <input aria-label="stub" />,
  DatePicker: () => <input aria-label="stub" type="date" />,
}));
vi.mock("./webhooks/actions", () => ({
  redeliverAction: () => Promise.resolve({ status: "idle" }),
  redeliverAllAction: () => Promise.resolve({ status: "idle" }),
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
  FlagTag: () => <span data-testid="qcms-flag-tag-stub" />,
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

/**
 * The forms read on this page is pinned successful and empty by `beforeEach`, so the only
 * alert the assertions below can be seeing is the dead-letter queue's own.
 */
async function renderWebhooks(): Promise<string> {
  const { default: Page } = await import("./webhooks/page.tsx");
  return renderToStaticMarkup(await Page());
}

/**
 * One form's response browser, at whatever querystring the case needs.
 *
 * The form read is pinned successful by `beforeEach`, so the only alert these assertions
 * can see is the response list's own.
 */
async function renderResponses(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/responses/page.tsx");
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ formId: "frm_one" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  erasuresResult = { ok: true, data: [] };
  questionsResult = { ok: true, data: [] };
  formsResult = { ok: true, data: [] };
  deadLettersResult = { ok: true, data: [] };
  formDetailResult = { ok: true, data: FORM_DETAIL };
  responsesResult = { ok: true, data: { responses: [], page: 1, pageSize: 50, total: 0 } };
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
    // §3's CTA, and the only control on the screen carrying it: the filter card's own
    // reset stands down while the panel is showing, so the name is unambiguous.
    expect(html.match(/questions\.filter\.clear/g)).toHaveLength(1);
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

/**
 * `ops.deadLetters.emptyTitle` starts with `ops.deadLetters.empty`, so one
 * `not.toContain("ops.deadLetters.empty")` rules out both halves of the panel's copy at
 * once. That is deliberate: the claim being pinned is "no part of the empty state",
 * not "not this one string".
 */
describe("the dead-letter queue's three states (issue 543)", () => {
  it("makes no claim about the queue when the read fails", async () => {
    deadLettersResult = { ok: false, message: "upstream said 503" };

    const html = await renderWebhooks();

    // The whole point of the issue: "nothing is stuck" is the reassuring answer, and a
    // failed read does not have it. Neither the panel nor its copy nor the count.
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).not.toContain("ops.deadLetters.empty");
    expect(html).not.toContain("ops.deadLetters.total");
    expect(html).not.toMatch(/<table[\s>]/);
  });

  it("still renders the error alert when the read fails", async () => {
    deadLettersResult = { ok: false, message: "upstream said 503" };

    const html = await renderWebhooks();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("ops.deadLetters.loadFailed");
    // The region keeps its heading, exactly as the form list below it does on the same
    // page (issue 513): the alert needs a subject, and a heading claims nothing.
    expect(html).toContain('id="qcms-dead-letters-heading"');
  });

  it("still renders the empty panel when the queue genuinely reads clear", async () => {
    const html = await renderWebhooks();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("ops.deadLetters.emptyTitle");
    expect(html).toMatch(/qcms-empty__body">ops\.deadLetters\.empty</);
    expect(html).not.toMatch(/<table[\s>]/);
    expect(html).not.toContain('data-testid="qcms-alert"');
  });

  it("renders one family table, wrapped, when the queue has rows", async () => {
    deadLettersResult = { ok: true, data: [DEAD_LETTER] };

    const html = await renderWebhooks();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).not.toMatch(RETIRED_TABLE_CLASSES);
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).toContain("ops.deadLetters.total.one");
  });
});

/**
 * Issue 521, and the site of issue 572 it shares a page with.
 *
 * The response browser had TWO ways to state something it did not know, one inside the
 * other. Which empty sentence it shows is chosen from the querystring, and it used to be
 * chosen from an expression other than the one the API request was built from, so
 * `?flagged=maybe` produced "no response matches these filters" about a filter the page
 * had discarded. And the page handed the component `ok ? data : an empty page`, so a read
 * that failed produced the empty panel and "0 responses" underneath its own error alert.
 *
 * Both are the same defect and both are pinned here rather than in the browser suite: the
 * failure branch needs `listResponses` to fail, which no gesture in a browser can make
 * happen against a server component (the erasure block above gives the full argument).
 * The querystring pair is asserted at both layers on purpose, because the sentence is
 * what an operator reads.
 *
 * Red-first against the pre-change tree: the failure test fails on every one of its four
 * assertions (the panel, `ops.responses.empty`, the total and the pager all render), and
 * `?flagged=maybe` renders `ops.responses.filteredEmpty`.
 */
describe("the response browser's read states (issues 521, 572)", () => {
  it("makes no claim about responses when the list read fails", async () => {
    responsesResult = { ok: false, message: "upstream said 503" };

    const html = await renderResponses();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("ops.responses.listFailed");
    // No panel, no "nothing has been submitted", no count, no pager: every one of them
    // is a statement about rows that never arrived.
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).not.toContain("ops.responses.empty");
    expect(html).not.toContain("ops.responses.total");
    expect(html).not.toContain('data-testid="qcms-responses-paging"');
    expect(html).not.toMatch(/<table[\s>]/);
    // The heading and the toolbar survive: the alert needs a subject, filtering is a
    // navigation that triggers a fresh read, and Export is a separate request.
    expect(html).toContain('id="qcms-responses-heading"');
    expect(html).toContain('data-testid="qcms-response-filters"');
  });

  it("still renders the empty panel when the form genuinely has no responses", async () => {
    const html = await renderResponses();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("ops.responses.emptyTitle");
    // `ops.responses.emptyTitle` starts with `ops.responses.empty`, so the body has to be
    // matched where it lands rather than by substring, exactly as the queue's is above.
    expect(html).toMatch(/qcms-empty__body">ops\.responses\.empty</);
    expect(html).not.toContain('data-testid="qcms-alert"');
  });

  it("renders one family table, wrapped, when the page has rows", async () => {
    responsesResult = {
      ok: true,
      data: { responses: [RESPONSE_ROW], page: 1, pageSize: 50, total: 1 },
    };

    const html = await renderResponses();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).not.toMatch(RETIRED_TABLE_CLASSES);
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).toContain("ops.responses.total.one");
  });

  it("says the unfiltered kind of empty for a filter value nothing accepts", async () => {
    const html = await renderResponses({ flagged: "maybe", from: "nope" });

    // The reported defect: `maybe` never reached the API, so a filtered-empty claim about
    // it was false. The notice names both parameters instead.
    expect(html).toContain("ops.responses.empty");
    expect(html).not.toContain("ops.responses.filteredEmpty");
    expect(html).toContain('data-testid="qcms-responses-ignored-filters"');
  });

  it("keeps the filtered sentence when a valid filter survives beside a rejected one", async () => {
    const html = await renderResponses({ flagged: "true", from: "nope" });

    // The control, and the case the wireframe line used to get wrong: an ignored value
    // does not decide the empty state, the filters that DID parse do.
    expect(html).toContain("ops.responses.filteredEmpty");
    expect(html).toContain('data-testid="qcms-responses-ignored-filters"');
  });
});
