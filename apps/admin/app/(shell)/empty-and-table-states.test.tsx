import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

let erasuresResult: unknown = { ok: true, data: [] };
let questionsResult: unknown = { ok: true, data: [] };
let formsResult: unknown = { ok: true, data: [] };
let deadLettersResult: unknown = { ok: true, data: [] };
let formDetailResult: unknown = { ok: true, data: undefined };
let responsesResult: unknown = { ok: true, data: undefined };

const listedPages: number[] = [];

function pagedResponses(page: number): unknown {
  const result = responsesResult as
    { ok?: unknown; data?: { responses: unknown[]; pageSize: number; total: number } } | undefined;
  if (result?.ok !== true || result.data === undefined) return responsesResult;
  const { responses, pageSize, total } = result.data;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return { ok: true, data: { responses: page <= pages ? responses : [], page, pageSize, total } };
}

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

vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: () => <div data-testid="qcms-form-page-header-stub" />,
}));

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
  listResponses: (_session: unknown, _formId: string, filters?: { readonly page?: number }) => {
    const page = filters?.page ?? 1;
    listedPages.push(page);
    return Promise.resolve(pagedResponses(page));
  },
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve(questionsResult),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
  listAllForms: () => Promise.resolve(formsResult),
  getForm: () => Promise.resolve(formDetailResult),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listDeadLetters: () => Promise.resolve(deadLettersResult),
}));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

/* The real Dialog portals; static rendering a tree containing it produces empty markup. */
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
vi.mock("@/components/ops/ops-tags", () => ({
  erasureReasonText: (reason: string) => reason,
  FlagTag: () => <span data-testid="qcms-flag-tag-stub" />,
}));

const EMPTY_PANEL = /<div class="qcms-empty"[^>]*>/;
const EMPTY_HEADING = /<h2 class="qcms-empty__heading">/;

const RETIRED_TABLE_CLASSES = /qcms-ops-table|qcms-links-table/;

async function renderErasures(): Promise<string> {
  const { default: Page } = await import("./responses/erasures/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderQuestions(searchParams: Record<string, string>): Promise<string> {
  const { default: Page } = await import("./questions/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function renderForms(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function renderWebhooks(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./webhooks/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

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
  listedPages.length = 0;
});

describe("the erasure log's three states (issue 514)", () => {
  it("renders the alert and nothing else when the read fails", async () => {
    erasuresResult = { ok: false, message: "upstream said 503" };

    const html = await renderErasures();

    expect(html).toContain('data-testid="qcms-alert"');
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
    expect(html.match(/href="\/questions\/new"/g)).toHaveLength(1);
  });

  it("swaps the heading and drops the sentence when the library is filtered", async () => {
    const html = await renderQuestions({ q: "nothing matches this" });

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toContain("questions.empty.filtered");
    expect(html).not.toContain("questions.empty.body");
    expect(html.match(/questions\.filter\.clear/gu)).toHaveLength(1);
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

describe("the dead-letter queue's three states (issue 543)", () => {
  it("makes no claim about the queue when the read fails", async () => {
    deadLettersResult = { ok: false, message: "upstream said 503" };

    const html = await renderWebhooks();

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

describe("the response browser's read states (issues 521, 572)", () => {
  it("makes no claim about responses when the list read fails", async () => {
    responsesResult = { ok: false, message: "upstream said 503" };

    const html = await renderResponses();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("ops.responses.listFailed");
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).not.toContain("ops.responses.empty");
    expect(html).not.toContain("ops.responses.total");
    expect(html).not.toContain('data-testid="qcms-responses-paging"');
    expect(html).not.toMatch(/<table[\s>]/);
    expect(html).toContain('id="qcms-responses-heading"');
    expect(html).toContain('data-testid="qcms-response-filters"');
  });

  it("still renders the empty panel when the form genuinely has no responses", async () => {
    const html = await renderResponses();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain("ops.responses.emptyTitle");
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

    expect(html).toContain("ops.responses.empty");
    expect(html).not.toContain("ops.responses.filteredEmpty");
    expect(html).toContain('data-testid="qcms-responses-ignored-filters"');
  });

  it("keeps the filtered sentence when a valid filter survives beside a rejected one", async () => {
    const html = await renderResponses({ flagged: "true", from: "nope" });

    expect(html).toContain("ops.responses.filteredEmpty");
    expect(html).toContain('data-testid="qcms-responses-ignored-filters"');
  });
});

describe("a page past the end of the responses (issue #550)", () => {
  const ONE_FULL_PAGE = {
    ok: true,
    data: { responses: [RESPONSE_ROW], page: 1, pageSize: 50, total: 1 },
  };

  it("shows the last page's rows rather than claiming the form is empty", async () => {
    responsesResult = ONE_FULL_PAGE;

    const html = await renderResponses({ page: "99" });

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).not.toMatch(EMPTY_PANEL);
    expect(html).not.toContain("ops.responses.empty");
    expect(listedPages).toEqual([99, 1]);
  });

  it("reads once and keeps the empty panel when the form genuinely has nothing", async () => {
    const html = await renderResponses({ page: "99" });

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toContain("ops.responses.emptyTitle");
    expect(listedPages).toEqual([99]);
  });

  it("reads once for a page that is in range", async () => {
    responsesResult = ONE_FULL_PAGE;

    await renderResponses({ page: "1" });

    expect(listedPages).toEqual([1]);
  });
});
