import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MyAccess } from "../../lib/membership/types.ts";

const SESSION = {
  userId: "u_1",
  email: "operator@example.test",
  name: "Operator",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORM_ID = "frm_intake";
const SESSION_ID = "ses_01HQ";

const RESPONSE = {
  sessionId: SESSION_ID,
  formId: FORM_ID,
  formVersion: 3,
  submittedAt: "2026-10-18T00:00:00.000Z",
  accessMode: "anonymous",
  flaggedReason: null,
  contentHash: "sha256:0000",
  answers: {},
  ledger: [],
};

/** An owner holds the erase cell through their member role, never through a named grant. */
const NO_NAMED_GRANT: MyAccess = {
  userId: "u_1",
  installationAdmin: false,
  capabilities: {
    authoring: false,
    operations: true,
    workspaces: false,
    siteConfiguration: false,
  },
  workspaces: [
    {
      workspaceId: "ws_1",
      slug: "core",
      name: "Core",
      archived: false,
      memberRole: "owner",
      grants: [],
      environments: ["prod"],
    },
  ],
};

let cells: readonly string[] = [];

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));
vi.mock("@/lib/announce", () => ({ announce: () => undefined }));
vi.mock("@/lib/ops/unexpected", () => ({ unexpected: () => "ops.error.unexpected" }));
vi.mock("@/components/ops/ops-tags", () => ({
  flagReasonText: (reason: string) => reason,
}));
vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: () => <div data-testid="qcms-form-page-header-stub" />,
}));
/* The real Dialog portals; static rendering a tree containing it produces empty markup. */
vi.mock("@/components/kit", () => ({
  Alert: ({ children }: { children?: ReactNode }) => <div data-testid="qcms-alert">{children}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Select: () => <select aria-label="stub" />,
  TextField: () => <input aria-label="stub" />,
}));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/environments", () => ({
  resolvedEnvironment: () =>
    Promise.resolve({
      status: "known",
      environment: "prod",
      environments: ["prod", "test"],
      selection: "prod",
    }),
}));
vi.mock("@/lib/server/forms", () => ({
  getForm: () =>
    Promise.resolve({ ok: true, data: { formId: FORM_ID, slug: "intake", status: "open" } }),
  getFormVersion: () => Promise.resolve({ ok: false, code: "FORBIDDEN", message: "refused" }),
}));
vi.mock("@/lib/server/questions", () => ({
  getQuestion: () => Promise.resolve({ ok: false, code: "FORBIDDEN", message: "refused" }),
}));
vi.mock("@/lib/server/responses", () => ({
  getResponse: () => Promise.resolve({ ok: true, data: RESPONSE }),
  erasureScope: () => Promise.resolve({ ok: false, code: "FORBIDDEN", message: "refused" }),
  listErasures: () => Promise.resolve({ ok: true, data: [] }),
}));
vi.mock("@/lib/server/membership", () => ({
  readMyAccess: () => Promise.resolve({ ok: true, data: NO_NAMED_GRANT }),
}));
vi.mock("@/lib/server/operations", () => ({
  formCellsHeld: () => Promise.resolve(cells),
}));
vi.mock("@/lib/server/config", () => ({ secureCookies: () => false }));

const NOOP_ACTION = () => Promise.resolve({ status: "error" as const });

vi.mock("./responses/actions", () => ({
  eraseSessionAction: NOOP_ACTION,
  unflagResponseAction: NOOP_ACTION,
}));

async function render(): Promise<string> {
  const { default: Page } =
    await import("./operations/forms/[formId]/responses/[sessionId]/page.tsx");
  return renderToStaticMarkup(
    await Page({ params: Promise.resolve({ formId: FORM_ID, sessionId: SESSION_ID }) }),
  );
}

describe("the erasure door on one response", () => {
  it("offers no erase control to a caller holding only the reads", async () => {
    cells = ["response:read", "response:export"];

    const html = await render();

    expect(html).toContain('data-testid="qcms-response-detail"');
    expect(html).not.toContain("ops.erase.button");
  });

  it("offers it to a caller holding the erase cell on this form and environment", async () => {
    cells = ["response:read", "response:erase", "response:dispose"];

    const html = await render();

    expect(html).toContain("ops.erase.button");
  });
});
