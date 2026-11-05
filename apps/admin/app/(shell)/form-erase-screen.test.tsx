import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const SESSION = {
  userId: "u_1",
  email: "operator@example.test",
  name: "Operator",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORM_ID = "frm_intake";

let cells: readonly string[] = [];
let formResult: unknown = { ok: true, data: { formId: FORM_ID, slug: "intake", status: "open" } };

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
vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: ({ section }: { section: string }) => (
    <div data-testid="qcms-form-page-header-stub" data-section={section} />
  ),
}));
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
  getForm: () => Promise.resolve(formResult),
}));
vi.mock("@/lib/server/operations", () => ({
  formCellsHeld: () => Promise.resolve(cells),
}));
vi.mock("@/lib/server/config", () => ({ secureCookies: () => false }));
vi.mock("./responses/actions", () => ({
  eraseSessionAction: () => Promise.resolve({ status: "error" as const }),
  erasureLookupAction: () => Promise.resolve({ status: "missing" as const }),
}));

async function render(): Promise<string> {
  const { default: Page } = await import("./operations/forms/[formId]/erase/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ formId: FORM_ID }) }));
}

describe("one form's known-target erasure screen", () => {
  it("asks an erase-cell holder for a session id", async () => {
    cells = ["response:erase", "response:dispose"];
    const html = await render();

    expect(html).toContain('data-testid="qcms-known-target-erasure"');
    expect(html).toContain('data-section="erase"');
    expect(html).not.toContain("ops.erase.known.denied");
  });

  it("offers a caller without the erase cell nothing to act on", async () => {
    cells = ["response:read", "response:export"];
    const html = await render();

    expect(html).not.toContain('data-testid="qcms-known-target-erasure"');
    expect(html).toContain("ops.erase.known.denied");
  });

  it("still serves an eraser whose form read is refused", async () => {
    cells = ["response:erase"];
    formResult = { ok: false, code: "FORBIDDEN", message: "refused" };
    const html = await render();

    expect(html).toContain('data-testid="qcms-known-target-erasure"');
  });

  it("is not found for a form that does not exist", async () => {
    formResult = { ok: false, code: "FORM_NOT_FOUND", message: "missing" };
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
