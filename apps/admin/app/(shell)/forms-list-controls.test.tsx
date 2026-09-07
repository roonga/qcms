import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The form library's search, status filter and sort (issue 686), at the layer that can
 * see what the screen asked the API for.
 *
 * Three separate claims live here, and none of them is reachable from the browser suite
 * without a database in a known state:
 *
 * 1. **The filters go to the API, verbatim.** `listForms` is a proxy (R2), so the subject
 *    is the argument the page hands it. A browser test can only see the rows that came
 *    back, which would pass just as happily if this screen filtered them itself.
 * 2. **The controls come back from the URL.** A filtered library is a link, which is only
 *    true if reopening the link re-renders the toolbar showing the same three values.
 * 3. **Which empty panel appears.** "Nothing in the library yet" and "no form matches"
 *    are different sentences with different actions, and choosing between them is a
 *    decision about `isFiltered` rather than about row count alone.
 *
 * The i18n stub answers with its own key, so every assertion below is about which string
 * a branch chose rather than the sentence it holds today.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** One list row, in the shape `listForms` returns. */
const FORM_ROW = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  status: "open" as const,
  hasDraft: true,
  latestVersion: 1,
  publishedAt: "2026-02-01T00:00:00.000Z",
};

/**
 * What the stubbed `listForms` answers next, and what it was last asked for.
 *
 * The parameters are declared even though neither is read: the filter argument is the
 * subject of the first describe below, and an undeclared parameter list types
 * `mock.calls` as the empty tuple, where reading index 1 is a type error rather than the
 * assertion it looks like.
 */
let formsResult: unknown = { ok: true, data: [FORM_ROW] };
const listForms = vi.fn((_session: unknown, _filters?: unknown) => Promise.resolve(formsResult));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({ listForms }));
vi.mock("@/lib/i18n/en", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    t: (key: string) => key,
    tPlural: (one: string, other: string, count: number) => (count === 1 ? one : other),
  };
});

/** The table is a separate concern; stubbing it keeps these assertions about the screen. */
vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));

async function renderForms(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

/** What the page asked the API for on its most recent render. */
function askedFor(): unknown {
  return listForms.mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  formsResult = { ok: true, data: [FORM_ROW] };
  listForms.mockClear();
});

describe("the form library sends its filters to the API rather than applying them (R2)", () => {
  it("passes the search term, the status filter and the sort key straight through", async () => {
    await renderForms({ q: "vehicle", status: "closed", sort: "published-desc" });

    expect(askedFor()).toEqual({ search: "vehicle", status: "closed", sort: "published-desc" });
  });

  it("asks for the default order and no status when the URL names neither", async () => {
    await renderForms({});

    // `status` is absent rather than present-and-undefined: the query string the proxy
    // builds omits it entirely, which is what "any status" means on the wire.
    expect(askedFor()).toEqual({ search: "", sort: "slug-asc" });
  });

  it("asks for the default order when the URL names one the API does not offer", async () => {
    await renderForms({ sort: "whatever" });

    expect(askedFor()).toMatchObject({ sort: "slug-asc" });
  });
});

describe("the toolbar is a native GET form whose values come back from the URL", () => {
  it("submits by navigation, so the three controls work with JavaScript off", async () => {
    const markup = await renderForms({});

    // A GET form with no `action`: it submits to the route it is on, which is what makes
    // Apply a plain navigation rather than a handler this screen has to hydrate.
    expect(markup).toMatch(/<form[^>]*method="get"/u);
    expect(markup).not.toMatch(/<form[^>]*\baction=/u);
  });

  it("labels every control, and names the group the three of them form", async () => {
    const markup = await renderForms({});

    expect(markup).toContain("forms.filter.legend");
    for (const key of ["forms.filter.search", "forms.filter.status", "forms.filter.sort"]) {
      expect(markup).toContain(key);
    }
  });

  it("restores the search term into the field it came from", async () => {
    const markup = await renderForms({ q: "vehicle" });

    expect(markup).toMatch(/value="vehicle"/u);
  });

  it("offers exactly the four orders the API guarantees", async () => {
    const markup = await renderForms({});

    for (const key of ["slug-asc", "slug-desc", "published-desc", "published-asc"]) {
      expect(markup).toContain(`forms.filter.sort.${key}`);
    }
  });
});

describe("the three list states, and the panel each one shows", () => {
  it("counts the rows above the table", async () => {
    formsResult = { ok: true, data: [FORM_ROW, { ...FORM_ROW, formId: "frm_two", slug: "two" }] };

    const markup = await renderForms({});

    expect(markup).toContain('data-testid="qcms-forms-count"');
    expect(markup).toContain("forms.count.other");
  });

  it("counts one row with the singular, which is a catalog choice and not an appended s", async () => {
    const markup = await renderForms({});

    expect(markup).toContain("forms.count.one");
  });

  it("offers creating when an unfiltered library is empty", async () => {
    formsResult = { ok: true, data: [] };

    const markup = await renderForms({});

    expect(markup).toContain("forms.empty.title");
    expect(markup).not.toContain("forms.empty.filtered");
    // The header link stands down so the panel's CTA is the only control with that name.
    expect(markup.match(/forms\.new/gu)).toHaveLength(1);
  });

  it("offers clearing when a filtered library is empty", async () => {
    formsResult = { ok: true, data: [] };

    const markup = await renderForms({ q: "no-such-form" });

    expect(markup).toContain("forms.empty.filtered");
    expect(markup).not.toContain("forms.empty.title");
    // One "Clear filters", not two: the toolbar's link stands down while the panel
    // carries the action, the way the question library's does.
    expect(markup.match(/forms\.filter\.clear/gu)).toHaveLength(1);
    // And the header keeps offering creation, because the library is not empty.
    expect(markup).toContain("forms.new");
  });

  it("still calls an empty library empty when only the sort is set", async () => {
    formsResult = { ok: true, data: [] };

    const markup = await renderForms({ sort: "published-asc" });

    expect(markup).toContain("forms.empty.title");
  });

  it("shows the toolbar's clear link when a filter is on and rows came back", async () => {
    const markup = await renderForms({ status: "open" });

    expect(markup).toContain("forms.filter.clear");
    expect(markup).toContain('data-testid="qcms-forms-table-stub"');
  });

  it("renders no count and no table when the read fails", async () => {
    formsResult = { ok: false, message: "upstream said 503" };

    const markup = await renderForms({ q: "vehicle" });

    expect(markup).toContain("forms.error.listFailed");
    expect(markup).not.toContain('data-testid="qcms-forms-count"');
    expect(markup).not.toContain('data-testid="qcms-forms-table-stub"');
    // Nor either empty sentence: a failed read does not know whether forms exist.
    expect(markup).not.toContain("forms.empty.");
  });
});
