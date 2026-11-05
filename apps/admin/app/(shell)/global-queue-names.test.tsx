import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* These reads run in the Next server process, outside Playwright's page.route interception. */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const HELD = [{ formId: "frm_held", slug: "held-form" }];

let formsResult: unknown = { ok: true, data: [] };
const deadLetters = vi.hoisted(() => ({ names: undefined as unknown }));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  listAllForms: () => Promise.resolve(formsResult),
}));
vi.mock("@/lib/server/environments", () => ({
  resolvedEnvironment: () =>
    Promise.resolve({ status: "known", environment: "prod", environments: ["prod"] }),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listDeadLetters: () => Promise.resolve({ ok: true, data: [] }),
}));
vi.mock("@/lib/server/responses", () => ({
  listErasures: () =>
    Promise.resolve({
      ok: true,
      data: [
        {
          sessionId: "ses_one",
          formId: "frm_held",
          formVersion: 1,
          erasedAt: "2026-11-01T00:00:00.000Z",
          reason: "subject_request",
        },
        {
          sessionId: "ses_two",
          formId: "frm_unheld",
          formVersion: 2,
          erasedAt: "2026-11-02T00:00:00.000Z",
          reason: "subject_request",
        },
      ],
    }),
}));

vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ops/dead-letters", () => ({
  DeadLetters: ({ formNames }: { formNames: unknown }) => {
    deadLetters.names = formNames;
    return <div data-testid="qcms-dead-letters-stub" />;
  },
}));

vi.mock("./webhooks/actions", () => ({
  redeliverAction: () => Promise.resolve({ status: "idle" }),
  redeliverAllAction: () => Promise.resolve({ status: "idle" }),
}));

async function renderWebhooks(): Promise<string> {
  const { default: WebhooksPage } = await import("./webhooks/page.tsx");
  return renderToStaticMarkup(await WebhooksPage({ searchParams: Promise.resolve({}) }));
}

async function renderErasures(): Promise<string> {
  const { default: ErasureLogPage } = await import("./responses/erasures/page.tsx");
  return renderToStaticMarkup(await ErasureLogPage());
}

beforeEach(() => {
  deadLetters.names = undefined;
});

describe("the dead-letter queue", () => {
  it("offers no form picker: the Operations table is the forms picker", async () => {
    formsResult = { ok: true, data: HELD };
    const html = await renderWebhooks();

    expect(html).not.toMatch(/<(?:ul|ol)[\s>]/u);
    expect(html).not.toContain("/operations/forms/frm_held/webhooks");
  });

  it("names its rows from the forms this caller may read", async () => {
    formsResult = { ok: true, data: HELD };
    await renderWebhooks();
    expect(deadLetters.names).toEqual({ frm_held: "held-form" });
  });

  it("names nothing, and is not refused, when the form read is", async () => {
    formsResult = { ok: false, code: "FORBIDDEN", message: "no form read" };
    const html = await renderWebhooks();

    expect(deadLetters.names).toEqual({});
    expect(html).toContain('data-testid="qcms-dead-letters-stub"');
    expect(html).not.toContain("no form read");
  });
});

describe("the erasure log", () => {
  it("names a held form and shows the id of one this caller may not read", async () => {
    formsResult = { ok: true, data: HELD };
    const html = await renderErasures();

    expect(html).toContain('data-form-id="frm_held"');
    expect(html).toContain("held-form");
    expect(html).not.toContain('data-form-id="frm_unheld"');
    expect(html).toContain("frm_unheld");
  });

  it("still lists every row when the form read is refused", async () => {
    formsResult = { ok: false, code: "FORBIDDEN", message: "no form read" };
    const html = await renderErasures();

    expect(html).not.toContain('data-testid="qcms-queue-form"');
    expect(html.match(/data-session-id=/gu)).toHaveLength(2);
  });
});
