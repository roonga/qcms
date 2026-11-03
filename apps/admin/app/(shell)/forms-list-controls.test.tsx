import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORM_ROW = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  status: "open" as const,
  hasDraft: true,
  latestVersion: 1,
  publishedAt: "2026-02-01T00:00:00.000Z",
};

let formsResult: unknown = { ok: true, data: [FORM_ROW] };

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

vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));

async function renderForms(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function renderRail(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { default: Rail } = await import("./@rail/forms/page.tsx");
  return renderToStaticMarkup(await Rail({ searchParams: Promise.resolve(searchParams) }));
}

function askedFor(): unknown {
  return askedFilters;
}

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

    expect(markup).toMatch(/<form[^>]*method="get"/u);
    expect(markup).not.toMatch(/<form[^>]*\baction=/u);
  });

  it("is the search region the contract names, with the part's own title", async () => {
    const markup = await renderRail({});

    expect(markup).toMatch(/<form[^>]*role="search"/u);
    expect(markup).toContain("rail.filters");
    expect(markup).toContain('data-testid="qcms-rail-filters"');
  });

  it("labels every control, in the ruled order", async () => {
    const markup = await renderRail({});

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
    expect(await renderRail({ sort: "published-asc" })).not.toContain("rail.filters.active");
    expect(await renderRail({ q: "vehicle" })).toContain("rail.filters.activeOne");
    expect(await renderRail({ q: "vehicle", status: "open" })).toContain("rail.filters.active");
  });

  it("shows the clear link only once a filter is set", async () => {
    expect(await renderRail({})).not.toContain("rail.filters.clear");
    expect(await renderRail({ status: "open" })).toContain("rail.filters.clear");
  });

  it("carries the creating action, and the content column keeps its own", async () => {
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
    expect(markup.match(/forms\.new/gu)).toHaveLength(1);
  });

  it("offers clearing when a filtered library is empty", async () => {
    formsResult = { ok: true, data: [] };

    const markup = await renderForms({ q: "no-such-form" });

    expect(markup).toContain("forms.empty.filtered");
    expect(markup).not.toContain("forms.empty.title");
    expect(markup.match(/forms\.filter\.clear/gu)).toHaveLength(1);
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
    expect(markup).not.toContain("forms.empty.");
  });
});
