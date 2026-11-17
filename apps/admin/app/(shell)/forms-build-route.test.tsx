import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const DRAFT = {
  formId: "frm_one",
  defaultLocale: "en",
  title: { en: "Patient intake" },
  steps: [],
  rules: [],
};

const FORM_DETAIL = {
  formId: "frm_one",
  slug: "one",
  defaultLocale: "en",
  status: "open",
  draftSource: "open",
  versions: [],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeEnforceable: false,
  draftAgentAssisted: false,
  draftUpdatedAt: null,
  requiresSecondApprover: false,
  canWriteDraft: true,
  draft: DRAFT,
};

const FORM_ROW = {
  formId: "frm_one",
  slug: "one",
  defaultLocale: "en",
  status: "open",
  workspaceId: "org_default_workspace",
  hasDraft: true,
  latestVersion: null,
  publishedAt: null,
  title: { en: "Patient intake" },
};

function myAccess(roles: readonly string[], workspaceId = "org_default_workspace") {
  return {
    ok: true,
    data: {
      userId: "u_1",
      installationAdmin: false,
      capabilities: {
        authoring: true,
        operations: true,
        workspaces: false,
        siteConfiguration: false,
      },
      workspaces: [
        {
          workspaceId,
          slug: "default",
          name: "Default",
          archived: false,
          memberRole: null,
          grants: [{ name: "Authors", roles, environments: [] }],
          environments: [],
        },
      ],
      siteAdministrators: [],
    },
  };
}

let formResult: unknown = { ok: true, data: FORM_DETAIL };
let accessResult: unknown = myAccess(["forms.viewer", "forms.editor"]);
const builderProps: Record<string, unknown>[] = [];
const rowMenus: Record<string, unknown>[] = [];

/** What the list offers each row, as the table's own menu would read it. */
function offered(): boolean[] {
  return rowMenus.map((props) => {
    const canBuild = props["canBuild"] as ((form: typeof FORM_ROW) => boolean) | undefined;
    return canBuild?.(FORM_ROW) ?? false;
  });
}
const wizardProps: Record<string, unknown>[] = [];

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/workspace-context", () => ({
  currentWorkspaceId: () => Promise.resolve("org_default_workspace"),
}));
vi.mock("@/lib/server/forms", () => ({
  getForm: () => Promise.resolve(formResult),
  getAgentChanges: () =>
    Promise.resolve({
      ok: true,
      data: { base: null, draft: null, agentAssisted: false, changes: [] },
    }),
  listForms: () => Promise.resolve({ ok: true, data: [FORM_ROW] }),
}));
vi.mock("@/lib/server/membership", () => ({
  readMyAccess: () => Promise.resolve(accessResult),
}));
vi.mock("@/lib/server/shell", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shellAccess: () => Promise.resolve({ status: "unknown" }),
}));
vi.mock("@/lib/server/config", () => ({ secureCookies: () => false }));
vi.mock("@/components/forms/builder-shell", () => ({
  BuilderShell: (props: Record<string, unknown>) => {
    builderProps.push(props);
    return <div data-testid="qcms-builder-stub" />;
  },
}));
vi.mock("@/components/forms/publish-wizard", () => ({
  PublishWizard: (props: Record<string, unknown>) => {
    wizardProps.push(props);
    return <div data-testid="qcms-wizard-stub" />;
  },
}));
vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: () => <div data-testid="qcms-form-page-header-stub" />,
}));
vi.mock("./forms/forms-table", () => ({
  FormsTable: (props: Record<string, unknown>) => {
    rowMenus.push(props);
    return <div data-testid="qcms-forms-table-stub" />;
  },
}));
vi.mock("./forms/actions", () => ({
  createFormAction: () => Promise.resolve({ status: "idle" }),
  startBuildDraftAction: () => Promise.resolve({ status: "started" }),
  applyAgentEditAction: () => Promise.resolve({ status: "saved", undoToken: null }),
  readStoredDraftAction: () => Promise.resolve({ status: "read", definition: null }),
  reviewReleaseAction: () => Promise.resolve({ ok: false }),
  confirmPublishAction: () => Promise.resolve({ status: "idle" }),
  lookupPublishResultAction: () => Promise.resolve({ status: "idle" }),
}));
vi.mock("./forms/new/create-form", () => ({
  CreateForm: () => <form data-testid="qcms-create-form-stub" />,
}));
vi.mock("@/components/kit", () => ({
  Alert: ({ children }: { children?: ReactNode }) => <div data-testid="qcms-alert">{children}</div>,
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

async function renderFormBuild(formId = "frm_one"): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/build/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ formId }) }));
}

async function renderNewBuild(): Promise<string> {
  const { default: Page } = await import("./forms/new/build/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderNewForm(): Promise<string> {
  const { default: Page } = await import("./forms/new/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderFormsList(): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

async function renderPublish(query: Record<string, string | string[]>): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/publish/page.tsx");
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ formId: "frm_one" }),
      searchParams: Promise.resolve(query),
    }),
  );
}

function flag(on: boolean): void {
  vi.stubEnv("QCMS_FLAG_AGENT_AUTHORING", on ? "fake" : "");
}

beforeEach(() => {
  formResult = { ok: true, data: FORM_DETAIL };
  accessResult = myAccess(["forms.viewer", "forms.editor"]);
  builderProps.length = 0;
  rowMenus.length = 0;
  wizardProps.length = 0;
  flag(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the agent flag gates both build routes and both entries", () => {
  it("answers 404 on both build routes with the flag off", async () => {
    flag(false);
    await expect(renderFormBuild()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderNewBuild()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("leaves both entries out with the flag off", async () => {
    flag(false);
    const markup = await renderNewForm();
    expect(markup).not.toContain('href="/forms/new/build"');
    expect(markup).toContain("qcms-create-form-stub");
    await renderFormsList();
    expect(offered()).toEqual([false]);
  });

  it("offers both entries with the flag on to an Edit forms holder", async () => {
    const markup = await renderNewForm();
    expect(markup).toContain('href="/forms/new/build"');
    expect(markup).toContain("Start blank");
    expect(markup).toContain("Build with the assistant");
    await renderFormsList();
    expect(offered()).toEqual([true]);
  });
});

describe("who reaches the builder (X3, U1)", () => {
  it("renders the builder on the form's open draft for a caller who may write it", async () => {
    expect(await renderFormBuild()).toContain("qcms-builder-stub");
    expect(builderProps[0]).toMatchObject({
      formId: "frm_one",
      name: "Patient intake",
      userId: "u_1",
      workspaceId: "org_default_workspace",
      canPublish: true,
    });
    expect(builderProps[0]?.["startDraft"]).toBeUndefined();
    expect(builderProps[0]?.["edits"]).toMatchObject({
      apply: expect.any(Function),
      readStored: expect.any(Function),
    });
  });

  it("answers 404 to a View forms holder, so no tool is reached", async () => {
    formResult = { ok: true, data: { ...FORM_DETAIL, canWriteDraft: false } };
    await expect(renderFormBuild()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(builderProps).toHaveLength(0);
  });

  it("answers 404 to a user of another workspace, whom the API cannot show the form", async () => {
    formResult = { ok: false, code: "FORM_NOT_FOUND", message: "Not found", issues: [] };
    await expect(renderFormBuild("frm_elsewhere")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 404 on a new form to a caller without Edit forms in this workspace", async () => {
    accessResult = myAccess(["forms.viewer"]);
    await expect(renderNewBuild()).rejects.toThrow("NEXT_NOT_FOUND");
    accessResult = myAccess(["forms.editor"], "org_other");
    await expect(renderNewBuild()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 404 on a new form when the caller's access cannot be read", async () => {
    accessResult = { ok: false, code: "UPSTREAM_UNAVAILABLE", message: "Unavailable", issues: [] };
    await expect(renderNewBuild()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(builderProps).toHaveLength(0);
  });

  it("hides the entries from a View forms holder", async () => {
    accessResult = myAccess(["forms.viewer"]);
    expect(await renderNewForm()).not.toContain('href="/forms/new/build"');
    await renderFormsList();
    expect(offered()).toEqual([false]);
  });

  it("opens a new form's builder with no form id, and with Publish off", async () => {
    expect(await renderNewBuild()).toContain("qcms-builder-stub");
    expect(builderProps[0]).toMatchObject({ formId: null, canPublish: false });
  });

  it("asks for Start a new draft first when the form has no open draft", async () => {
    formResult = { ok: true, data: { ...FORM_DETAIL, draftSource: "seeded" } };
    await renderFormBuild();
    expect(typeof builderProps[0]?.["startDraft"]).toBe("function");
  });
});

describe("the publish wizard's returnTo is decided on the server", () => {
  it("hands back to the same form's builder", async () => {
    await renderPublish({ returnTo: "/forms/frm_one/build" });
    expect(wizardProps[0]?.["returnTo"]).toEqual({
      href: "/forms/frm_one/build",
      toBuilder: true,
    });
    expect(wizardProps[0]?.["changes"]).toMatchObject({ status: "read" });
  });

  it.each([
    "https://evil.example/forms/frm_one/build",
    "//evil.example/forms/frm_one/build",
    "/forms/frm_two/build",
    "/forms/frm_one%2Fbuild",
    "/forms/frm_one/build%5C",
    "/operations",
  ])("falls back to the form page for %s", async (returnTo) => {
    await renderPublish({ returnTo });
    expect(wizardProps[0]?.["returnTo"]).toEqual({ href: "/forms/frm_one", toBuilder: false });
  });

  it("ignores returnTo with the flag off", async () => {
    flag(false);
    await renderPublish({ returnTo: "/forms/frm_one/build" });
    expect(wizardProps[0]?.["returnTo"]).toBeUndefined();
  });

  it("changes nothing when no returnTo is asked for", async () => {
    await renderPublish({});
    expect(wizardProps[0]?.["returnTo"]).toBeUndefined();
    expect(wizardProps[0]?.["changes"]).toBeUndefined();
  });
});
