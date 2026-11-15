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

const FORM_DETAIL = {
  formId: "frm_one",
  slug: "one",
  defaultLocale: "en",
  status: "open",
  draftSource: "open",
  versions: [{ version: 7, status: "published", publishedAt: "2026-08-01T10:00:00.000Z" }],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeEnforceable: false,
  draftAgentAssisted: false,
  draftUpdatedAt: null,
  draft: {
    formId: "frm_one",
    defaultLocale: "en",
    title: { en: "One" },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "Step one" },
        items: [{ questionId: "q_one", version: 1 }],
      },
    ],
    rules: [],
  },
};

const SNAPSHOT = {
  formId: "frm_one",
  version: 7,
  publishedAt: "2026-08-01T10:00:00.000Z",
  compilerVersion: "1.0.0",
  a2uiSpecVersion: "1.0.0",
  semanticsVersion: "1.0.0",
  definition: {},
  documents: [],
};

const UPSTREAM_FAILURE = { ok: false, code: "http_503", message: "upstream said 503", issues: [] };

let formDetailResult: unknown = { ok: true, data: FORM_DETAIL };
let versionResult: unknown = { ok: true, data: SNAPSHOT };

vi.mock("@/components/forms/rail-steps", () => ({ RailSteps: () => null }));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string, params?: Readonly<Record<string, string | number>>) =>
    params === undefined ? key : `${key}(${Object.values(params).join(",")})`,
  tPlural: (one: string) => one,
}));

/* The real Dialog portals; static rendering a tree containing it produces empty markup. */
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
  Breadcrumb: () => <nav data-testid="qcms-breadcrumb-stub" />,
}));

vi.mock("@/components/forms/version-view", () => ({
  VersionView: () => <div data-testid="qcms-version-view-stub" />,
}));

vi.mock("@/components/forms/form-subtree-rail", () => ({
  FormSubtreeRail: ({ current }: { current: { readonly section?: string } }) => (
    <nav data-testid="qcms-rail-stub" data-current={current.section} />
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));

vi.mock("@/lib/server/config", () => ({
  previewPortalTheme: () => "default",
}));

/* Mock both specifiers: the page uses the alias, while the real form-rail loader imports its relative
   neighbor. */
vi.mock("@/lib/server/forms", () => ({
  getForm: () => Promise.resolve(formDetailResult),
  getFormVersion: () => Promise.resolve(versionResult),
  validateDraft: () => Promise.resolve({ ok: true, data: { valid: true, issues: [] } }),
}));

const PARAMS = { formId: "frm_one", version: "7" };

async function renderVersionDetail(): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/versions/[version]/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve(PARAMS) }));
}

async function renderRail(): Promise<string> {
  const { FormRailSlot } = await import("./@rail/forms/[formId]/rail-slot.tsx");
  return renderToStaticMarkup(
    await FormRailSlot({
      params: Promise.resolve(PARAMS),
      current: { kind: "section", section: "versions" },
    }),
  );
}

beforeEach(() => {
  formDetailResult = { ok: true, data: FORM_DETAIL };
  versionResult = { ok: true, data: SNAPSHOT };
});

describe("the version read failing (issue 614)", () => {
  it("keeps the h1, the back link and the identity line", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    expect.soft(html).not.toContain("qcms-breadcrumb-stub");
    expect.soft(html).toContain('id="qcms-version-heading"');
    expect.soft(html).toContain("forms.history.versionHeading(7)");
    expect.soft(html).toContain("forms.history.backToHistory");
    expect.soft(html).toContain('href="/forms/frm_one/versions"');
    expect.soft(html).toContain("ids.copy.form(frm_one)");
    expect.soft(html).toContain("forms.status.open");
  });

  it("replaces only the body, with the error alert", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    expect(html).toContain('data-testid="qcms-alert" data-variant="error"');
    expect(html).toContain("forms.history.failed(upstream said 503)");
    expect(html).not.toContain('data-testid="qcms-version-view-stub"');
  });

  it("still 404s when the version simply does not exist", async () => {
    versionResult = { ...UPSTREAM_FAILURE, code: "VERSION_NOT_FOUND" };

    await expect(renderVersionDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the form read failing, where the bare alert is the honest answer (issue 614)", () => {
  it("renders the alert alone, because the header's own inputs failed with the read", async () => {
    formDetailResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    expect(html).toContain('data-testid="qcms-alert" data-variant="error"');
    expect(html).toContain("upstream said 503");
    expect(html).not.toContain('data-testid="qcms-breadcrumb-stub"');
    expect(html).not.toContain('id="qcms-version-heading"');
    expect(html).not.toContain("forms.history.backToHistory");
    expect(html).not.toContain('data-testid="qcms-version-view-stub"');
  });

  it("still 404s when the form simply does not exist", async () => {
    formDetailResult = { ...UPSTREAM_FAILURE, code: "FORM_NOT_FOUND" };

    await expect(renderVersionDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the success path, unchanged", () => {
  it("renders the header, the back link and the version body, with no alert", async () => {
    const html = await renderVersionDetail();

    expect(html).toContain('id="qcms-version-heading"');
    expect(html).toContain("forms.history.versionHeading(7)");
    expect(html).toContain("forms.history.backToHistory");
    expect(html).toContain('data-testid="qcms-version-view-stub"');
    expect(html).not.toContain('data-testid="qcms-alert"');
  });
});

describe("the rail beside the same URL (issues 561, 614)", () => {
  it("is untouched by a failed version read, because it never reads the version", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderRail();

    expect(html).toContain('data-testid="qcms-rail-stub"');
    expect(html).toContain('data-current="versions"');
  });

  it("degrades to nothing when the form read fails, leaving the screen's alert to speak", async () => {
    formDetailResult = UPSTREAM_FAILURE;

    const html = await renderRail();

    expect(html).toBe("");
  });
});
