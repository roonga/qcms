import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/* These reads run in the Next server process, outside Playwright's page.route interception. */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORMS = [
  { formId: "frm_one", slug: "one" },
  { formId: "frm_two", slug: "two" },
];

let formsResult: unknown = { ok: true, data: [] };

const deadLettersResult: unknown = { ok: true, data: [] };

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
  listAllForms: () => Promise.resolve(formsResult),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listDeadLetters: () => Promise.resolve(deadLettersResult),
}));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
}));

vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ops/dead-letters", () => ({
  DeadLetters: () => <div data-testid="qcms-dead-letters-stub" />,
}));

const LIST_ELEMENT = /<(?:ul|ol)[\s>]/;

async function renderWebhooks(): Promise<string> {
  const { default: WebhooksPage } = await import("./webhooks/page.tsx");
  return renderToStaticMarkup(await WebhooksPage({ searchParams: Promise.resolve({}) }));
}

describe.each([
  {
    area: "/webhooks",
    render: renderWebhooks,
    emptyKey: "ops.area.webhooks.noForms",
    pickKey: "ops.area.webhooks.pickForm",
    failedKey: "ops.area.responses.formsFailed",
  },
])("$area form list", ({ render, emptyKey, pickKey, failedKey }) => {
  it("renders no list element at all when the forms read fails (issue 513)", async () => {
    formsResult = { ok: false, message: "upstream said 503" };

    const html = await render();

    expect(html).not.toMatch(LIST_ELEMENT);
    expect(html).not.toContain(emptyKey);
  });

  it("still shows the error alert when the forms read fails", async () => {
    formsResult = { ok: false, message: "upstream said 503" };

    const html = await render();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain(failedKey);
  });

  it("renders the zero-forms sentence, and no list, when the read succeeds with nothing", async () => {
    formsResult = { ok: true, data: [] };

    const html = await render();

    expect(html).toContain(emptyKey);
    expect(html).not.toMatch(LIST_ELEMENT);
  });

  it("renders one list item per form when the read succeeds with forms", async () => {
    formsResult = { ok: true, data: FORMS };

    const html = await render();

    expect(html).toMatch(LIST_ELEMENT);
    expect(html.match(/<li[\s>]/g)).toHaveLength(FORMS.length);
    expect(html).toContain(pickKey);
    expect(html).not.toContain(emptyKey);
  });
});
