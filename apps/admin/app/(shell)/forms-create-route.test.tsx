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

let formsResult: unknown = { ok: true, data: [] };
let questionsResult: unknown = { ok: true, data: [] };

const FORM_ROW = {
  formId: "frm_vehicle_insurance",
  slug: "vehicle-insurance",
  defaultLocale: "en",
  status: "open",
  workspaceId: "org_default_workspace",
  hasDraft: true,
  publishedVersion: null,
  publishedAt: null,
};

const QUESTION_ROW = {
  questionId: "q_cover_type",
  slug: "cover-type",
  type: "shortText",
  status: "draft",
  label: { en: "Type of cover" },
  createdAt: "2026-08-01T10:00:00.000Z",
  latestVersion: 1,
};

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
  listAllForms: () => Promise.resolve(formsResult),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve(questionsResult),
}));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

vi.mock("@/components/kit", () => ({
  Alert: ({ children }: { children?: ReactNode }) => <div data-testid="qcms-alert">{children}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Card: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-card-stub">{children}</div>
  ),
  Select: () => <select aria-label="stub" />,
  TextField: ({ name, label }: { name?: string; label?: string }) => (
    <input aria-label={label ?? "stub"} data-field={name ?? ""} />
  ),
}));

vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));
vi.mock("@/components/questions/questions-table", () => ({
  QuestionsTable: () => <div data-testid="qcms-questions-table-stub" />,
}));

vi.mock("./forms/actions", () => ({
  createFormAction: () => Promise.resolve({ status: "idle" }),
}));

async function renderForms(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function renderNewForm(): Promise<string> {
  const { default: Page } = await import("./forms/new/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderQuestions(searchParams: Record<string, string>): Promise<string> {
  const { default: Page } = await import("./questions/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

beforeEach(() => {
  formsResult = { ok: true, data: [] };
  questionsResult = { ok: true, data: [] };
});

describe("the forms list stops creating inline (issue 685)", () => {
  it("renders no creating form on the list screen, at any state of the list", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };
    const populated = await renderForms();
    formsResult = { ok: true, data: [] };
    const empty = await renderForms();

    for (const markup of [populated, empty]) {
      expect(markup).not.toContain('data-field="slug"');
      expect(markup).not.toContain('data-field="defaultLocale"');
      expect(markup).not.toMatch(/<form[^>]*method="post"/iu);
      expect(markup).not.toMatch(/<form[^>]*\baction=/iu);
    }
  });

  it("names no part of the create copy on the list screen", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };

    const markup = await renderForms();

    expect(markup).not.toContain("forms.create.");
  });

  it("points at the new route from the list header once the library has rows", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };

    const markup = await renderForms();

    expect(hrefs(markup)).toContain("/forms/new");
    expect(markup).toContain("forms.new");
  });

  it("moves the creating action into the empty panel, and leaves one control carrying it", async () => {
    const markup = await renderForms();

    expect(markup).toContain('<div class="qcms-empty"');
    expect(hrefs(markup).filter((href) => href === "/forms/new")).toHaveLength(1);
    expect(markup).toContain("forms.empty.title");
  });
});

describe("the new-form route (issue 685)", () => {
  it("holds the three fields the inline card held", async () => {
    const markup = await renderNewForm();

    expect(markup).toContain('data-field="slug"');
    expect(markup).toContain('data-field="title"');
    expect(markup).toContain('data-field="defaultLocale"');
  });

  it("heads the screen with its own name, and leaves the way back to the rail", async () => {
    const markup = await renderNewForm();

    expect(markup).toMatch(/<h1[^>]*>forms\.create\.title<\/h1>/u);
    expect(hrefs(markup)).not.toContain("/forms");
  });

  it("says what the permanent id will be, where the choice that mints it is made", async () => {
    const markup = await renderNewForm();

    expect(markup).toContain("qcms-id-callout");
    expect(markup).toContain("forms.create.id");
    expect(markup).toContain("forms.create.idNote");
  });
});

describe("the question library's shipped pattern is unchanged by issue 685", () => {
  it("still links to /questions/new from its header when the library has rows", async () => {
    questionsResult = { ok: true, data: [QUESTION_ROW] };

    const markup = await renderQuestions({});

    expect(hrefs(markup)).toContain("/questions/new");
  });

  it("still offers the creating action from the panel alone when the library is empty", async () => {
    const markup = await renderQuestions({});

    expect(hrefs(markup).filter((href) => href === "/questions/new")).toHaveLength(1);
  });

  it("still renders no creating form on the list screen itself", async () => {
    questionsResult = { ok: true, data: [QUESTION_ROW] };

    const markup = await renderQuestions({});

    expect(markup).not.toContain("questions.create.");
  });
});
