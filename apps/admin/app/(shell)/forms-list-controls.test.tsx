import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
 *    true if reopening the link re-renders the controls showing the same three values. The
 *    controls are in the rail, so this claim is read off the `@rail` slot.
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

/** What the stubbed `listForms` answers next. */
let formsResult: unknown = { ok: true, data: [FORM_ROW] };

/**
 * The filter argument of the most recent call, which the first describe below is about.
 *
 * Recorded by the stub rather than read off `mock.calls`: a `vi.fn` whose parameters are
 * only declared to be ignored types its call tuple as empty, so the index that would
 * carry the filters is a type error rather than the assertion it looks like.
 */
let askedFilters: unknown;

const listForms = vi.fn((_session: unknown, filters?: unknown) => {
  askedFilters = filters;
  return Promise.resolve(formsResult);
});

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

/**
 * The rail beside that column, where the three controls live.
 *
 * Rendered here rather than in a file of its own because this file's three claims are one
 * behaviour read at three points: what the page asked the API for, what the controls show,
 * and which empty panel appeared. The slot reads no data, so nothing extra is stubbed.
 */
async function renderRail(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { default: Rail } = await import("./@rail/forms/page.tsx");
  return renderToStaticMarkup(await Rail({ searchParams: Promise.resolve(searchParams) }));
}

/** What the page asked the API for on its most recent render. */
function askedFor(): unknown {
  return askedFilters;
}

/**
 * Pay the page module's first import here rather than inside the first case.
 *
 * `import("./forms/page.tsx")` pulls the whole vendored kit in behind it, and on a
 * loaded machine that transform can outlast a test's default five-second budget on its
 * own - which is what it did on a forced parallel run of every package's suite, failing
 * the first `it` in this file with a timeout that had nothing to do with the assertion
 * in it. Charging it to a `beforeAll` with a real budget keeps every case below timing
 * only the render it is about (CONTRIBUTING, issue 503).
 */
beforeAll(async () => {
  await import("./forms/page.tsx");
}, 60_000);

beforeEach(() => {
  formsResult = { ok: true, data: [FORM_ROW] };
  askedFilters = undefined;
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

describe("the rail's Filters part is a native GET form whose values come back from the URL", () => {
  it("submits by navigation, so Apply needs no handler this screen hydrates", async () => {
    const markup = await renderRail({});

    // A GET form with no `action`: it submits to the route it is on, which is what makes
    // Apply a plain navigation rather than a handler this screen has to hydrate. The move
    // into the rail changed the column it renders in and nothing about that property.
    expect(markup).toMatch(/<form[^>]*method="get"/u);
    expect(markup).not.toMatch(/<form[^>]*\baction=/u);
  });

  it("is the search region the contract names, with the part's own title", async () => {
    const markup = await renderRail({});

    // §7.0 ruling 2.4: the filters sit in `<form role="search">` under a "Filters" title,
    // which is a styled paragraph rather than a heading element - the rail renders before
    // `<main>`, so a heading there breaks `heading-order` (§7.0's clarifications).
    expect(markup).toMatch(/<form[^>]*role="search"/u);
    expect(markup).toContain("rail.filters");
    expect(markup).toContain('data-testid="qcms-rail-filters"');
  });

  it("labels every control, in the ruled order", async () => {
    const markup = await renderRail({});

    // Search, status, then sort (§7.0 ruling 2.4), asserted as positions rather than as
    // presence: the order is the part of this that is contract rather than markup.
    const order = ["forms.filter.search", "forms.filter.status", "forms.filter.sort"].map((key) =>
      markup.indexOf(key),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("restores the search term into the field it came from", async () => {
    const markup = await renderRail({ q: "vehicle" });

    expect(markup).toMatch(/value="vehicle"/u);
  });

  it("offers exactly the four orders the API guarantees", async () => {
    const markup = await renderRail({});

    for (const key of ["slug-asc", "slug-desc", "published-desc", "published-asc"]) {
      expect(markup).toContain(`forms.filter.sort.${key}`);
    }
  });

  it("counts the filters in force, and does not count the sort among them", async () => {
    // The count the part shows beside its title and the Header shows below
    // `--bp-sidebar`. A sort hides no row, so counting it would claim the library was
    // narrowed when it is only reordered.
    expect(await renderRail({ sort: "published-asc" })).not.toContain("rail.filters.active");
    expect(await renderRail({ q: "vehicle" })).toContain("rail.filters.activeOne");
    expect(await renderRail({ q: "vehicle", status: "open" })).toContain("rail.filters.active");
  });

  it("shows the clear link only once a filter is set", async () => {
    expect(await renderRail({})).not.toContain("rail.filters.clear");
    expect(await renderRail({ status: "open" })).toContain("rail.filters.clear");
  });

  it("carries the creating action, and the content column keeps its own", async () => {
    // §7.0's table gives this rail one Action. Both links exist on the screen and that is
    // the §3 rule rather than a duplicate: the column's link stands down only when the
    // unfiltered-empty panel is carrying it instead.
    expect(await renderRail({})).toContain('href="/forms/new"');
    expect(await renderForms({})).toContain('href="/forms/new"');
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
    // §3's CTA, which this panel keeps even though the rail offers one too.
    expect(markup.match(/forms\.filter\.clear/gu)).toHaveLength(1);
    // And the header keeps offering creation, because the library is not empty.
    expect(markup).toContain("forms.new");
  });

  it("still calls an empty library empty when only the sort is set", async () => {
    formsResult = { ok: true, data: [] };

    const markup = await renderForms({ sort: "published-asc" });

    expect(markup).toContain("forms.empty.title");
  });

  it("renders the table when a filter is on and rows came back", async () => {
    const markup = await renderForms({ status: "open" });

    expect(markup).toContain('data-testid="qcms-forms-table-stub"');
    expect(markup).not.toContain("forms.empty.");
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
