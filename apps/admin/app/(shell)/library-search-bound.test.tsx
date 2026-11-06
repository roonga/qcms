import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

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

const FORM_ROW = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  status: "open" as const,
  workspaceId: "org_default_workspace",
  hasDraft: true,
  latestVersion: 1,
  publishedAt: "2026-02-01T00:00:00.000Z",
};

vi.mock("@/lib/server/workspace-context", () => ({
  currentWorkspaceId: () => Promise.resolve("org_default_workspace"),
  currentWorkspaceContext: () =>
    Promise.resolve({
      choices: [{ workspaceId: "org_default_workspace", name: "Default workspace" }],
      current: { workspaceId: "org_default_workspace", name: "Default workspace" },
    }),
}));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve({ ok: true, data: [QUESTION_ROW] }),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve({ ok: true, data: [FORM_ROW] }),
  listAllForms: () => Promise.resolve({ ok: true, data: [FORM_ROW] }),
}));

vi.mock("@/components/questions/questions-table", () => ({
  QuestionsTable: () => <div data-testid="qcms-questions-table-stub" />,
}));
vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));

async function renderQuestions(): Promise<string> {
  const { default: Rail } = await import("./@rail/questions/page.tsx");
  return renderToStaticMarkup(await Rail({ searchParams: Promise.resolve({}) }));
}

async function renderForms(): Promise<string> {
  const { default: Rail } = await import("./@rail/forms/page.tsx");
  return renderToStaticMarkup(await Rail({ searchParams: Promise.resolve({}) }));
}

beforeAll(async () => {
  await import("./@rail/questions/page.tsx");
  await import("./@rail/forms/page.tsx");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
});

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
    expect(LIBRARY_SEARCH_MAX_LENGTH).toBe(200);
  });
});
