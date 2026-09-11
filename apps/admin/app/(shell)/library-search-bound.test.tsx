import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";

/**
 * The client-side half of the library search bound (issues #686, #862).
 *
 * The API caps a library search term at 200 characters and answers 400 past it, on both
 * library routes. The bound is the API's and stays the API's; what this file is about is
 * that the *input* carries it too, so an author who pastes an essay into the search box
 * is stopped at the field rather than at an error page.
 *
 * Rendered with the real kit rather than a stub, because the claim is an attribute the
 * vendored `TextField` emits: `maxLength` is a prop this screen passes and the component
 * renders, and a stubbed control would let the prop disappear with every assertion still
 * green. That is also why this is its own file - `empty-and-table-states.test.tsx`
 * renders both these pages with `@/components/kit` mocked, so the attribute is not
 * observable there at all.
 *
 * Both screens are asserted, and asserted against the same exported constant, because
 * the two libraries are the same screen twice: a bound one carries and the other does
 * not is exactly the drift issue #862 was filed about.
 *
 * Red-first: against the pre-change JSX both cases fail on the missing `maxlength`
 * attribute (neither page passed the prop), and the API half fails at
 * `apps/api/src/openapi-document.test.ts`, where `?search` on `/admin/questions`
 * published no `maxLength` at all.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** One question library row, in the shape `listQuestions` returns. */
const QUESTION_ROW = {
  questionId: "q_colour",
  slug: "colour",
  createdAt: "2026-02-01T00:00:00.000Z",
  latestVersion: 1,
  latestStatus: "draft" as const,
  publishedAt: null,
  label: { en: "Favourite colour" },
  type: "shortText" as const,
};

/** One form library row, in the shape `listForms` returns. */
const FORM_ROW = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  status: "open" as const,
  hasDraft: true,
  latestVersion: 1,
  publishedAt: "2026-02-01T00:00:00.000Z",
};

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve({ ok: true, data: [QUESTION_ROW] }),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve({ ok: true, data: [FORM_ROW] }),
}));

/** The tables are a separate concern; stubbing them keeps this about the toolbar. */
vi.mock("@/components/questions/questions-table", () => ({
  QuestionsTable: () => <div data-testid="qcms-questions-table-stub" />,
}));
vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));

async function renderQuestions(): Promise<string> {
  const { default: Page } = await import("./questions/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

async function renderForms(): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

/**
 * Pay both page modules' first import here rather than inside the first case, for the
 * reason `forms-list-controls.test.tsx` records: the import pulls the whole vendored kit
 * in behind it, and on a loaded machine that transform can outlast a case's default
 * budget on its own (CONTRIBUTING, issue 503).
 */
beforeAll(async () => {
  await import("./questions/page.tsx");
  await import("./forms/page.tsx");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The search box's `maxlength`, read the way a browser reads it.
 *
 * Parsed into a real element rather than matched as a substring, because the markup
 * spells the attribute `maxLength` and HTML attribute names are case-insensitive: a
 * string assertion here would be pinning React's casing rather than the bound, and would
 * go red on a rendering change that keeps the field just as bounded.
 */
function searchInputMaxLength(markup: string): string | null {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const input = host.querySelector('input[name="q"]');
  return input?.getAttribute("maxlength") ?? null;
}

describe("both library search boxes carry the API's bound (issues #686, #862)", () => {
  it("puts the bound on the question library's search input", async () => {
    expect(searchInputMaxLength(await renderQuestions())).toBe(String(LIBRARY_SEARCH_MAX_LENGTH));
  });

  it("puts the same bound on the form library's search input", async () => {
    expect(searchInputMaxLength(await renderForms())).toBe(String(LIBRARY_SEARCH_MAX_LENGTH));
  });

  it("uses the number the API refuses past, so the two halves cannot drift apart", () => {
    // `ListQuestionsQuery.search` and `ListFormsQuery.search` are both `.max(200)`.
    expect(LIBRARY_SEARCH_MAX_LENGTH).toBe(200);
  });
});
