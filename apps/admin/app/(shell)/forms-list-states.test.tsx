import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Issue #513: `/responses` and `/webhooks` have **three** states for the form list, and
 * for a while the JSX only distinguished two.
 *
 * Both screens read the form list through `listForms`, which answers `{ok:false}` on a
 * failed read. The old shape was `forms.ok && forms.data.length === 0 ? <p/> : <ul/>`,
 * whose `else` branch catches the failure case as well as the populated one - so a failed
 * read rendered an empty `<ul>` beneath the error alert. A screen reader announces that as
 * "list, 0 items"; a sighted operator sees an empty box. Neither says what the alert
 * already said, which is that the list could not be loaded.
 *
 * ## Why this is a Vitest test and not a Playwright one
 *
 * ADR-23 puts route-level rendering assertions in Playwright, and that is where this
 * would live if the state were reachable from a browser. It is not. `listForms` runs in
 * the Next **server** process (`lib/server/forms.ts` -> `adminApiFetch`), so
 * `page.route()` never sees it, and nothing the browser controls can make that one call
 * fail: the request carries the SEC-4 internal token and the admin's session token, both
 * read server-side, and a session bad enough to fail it is a session `requireAdminSession`
 * has already redirected away. The API's address is process-wide configuration, and the
 * root Playwright config records the reason a second, differently-configured admin server
 * is not an option: "a webServer cannot be booted twice with two environments". The same
 * constraint put `preview-theme.test.ts` at this layer, for the same stated reason.
 *
 * So the highest layer that can reach the failure branch is this one: call the page's
 * server component with `listForms` stubbed, and assert over the HTML it actually
 * produces. That is a render assertion, not a source-shape assertion - it went red
 * against the pre-fix JSX, emitting
 * `<ul class="flex flex-col gap-1" data-testid="qcms-responses-form-list"></ul>`.
 *
 * ## What is deliberately not asserted
 *
 * The *design* of the zero-forms state (its copy, its element, its styling) belongs to
 * issue #514, which harmonises the admin's empty states. So the empty case is pinned by
 * i18n **key** rather than by sentence, and nothing here constrains how that state looks.
 * What is pinned is the failure branch: no list element, and the alert still present.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** The stubbed form list, in the shape `listForms` returns. */
const FORMS = [
  { formId: "frm_one", slug: "one" },
  { formId: "frm_two", slug: "two" },
];

/**
 * Set per test before the page module is imported, so one set of module mocks can serve
 * all three states. A `let` rather than `vi.mocked(...)` juggling: the page calls
 * `listForms` exactly once, at render.
 */
let formsResult: unknown = { ok: true, data: [] };

/**
 * The dead-letter read is never the subject here, so it is pinned to a successful empty
 * answer: the webhooks page must reach its form-list branch without the queue's own error
 * alert confusing the assertions below.
 */
const deadLettersResult: unknown = { ok: true, data: [] };

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listDeadLetters: () => Promise.resolve(deadLettersResult),
}));

/**
 * `t` answers with its own key. The assertions below are then about *which* string a
 * branch chose, not about the sentence it happens to hold today - which is what leaves
 * #514 free to rewrite the copy without touching this file.
 */
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
}));

/** A marked stand-in for the kit `Alert`, so its presence and variant are assertable. */
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
}));

/**
 * The dead-letter table is stubbed out entirely. It is a separate concern with its own
 * error alert above it, and rendering the real one here would put a second `<table>` into
 * the markup this file makes "no list element" claims about.
 */
vi.mock("@/components/ops/dead-letters", () => ({
  DeadLetters: () => <div data-testid="qcms-dead-letters-stub" />,
}));

/** Any element that announces itself as a list. The whole point of the issue. */
const LIST_ELEMENT = /<(?:ul|ol)[\s>]/;

async function renderResponses(): Promise<string> {
  const { default: ResponsesPage } = await import("./responses/page.tsx");
  return renderToStaticMarkup(await ResponsesPage());
}

async function renderWebhooks(): Promise<string> {
  const { default: WebhooksPage } = await import("./webhooks/page.tsx");
  return renderToStaticMarkup(await WebhooksPage());
}

describe.each([
  {
    area: "/responses",
    render: renderResponses,
    emptyKey: "ops.area.responses.noForms",
    pickKey: "ops.area.responses.pickForm",
    failedKey: "ops.area.responses.formsFailed",
  },
  {
    area: "/webhooks",
    render: renderWebhooks,
    emptyKey: "ops.area.webhooks.noForms",
    pickKey: "ops.area.webhooks.pickForm",
    failedKey: "ops.area.responses.formsFailed",
  },
])("$area form list", ({ render, emptyKey, pickKey, failedKey }) => {
  // "issue 513" rather than "#513": `check-admin-theme` reads a `#nnn` in a string
  // literal as a hex colour and fails the gate on it.
  it("renders no list element at all when the forms read fails (issue 513)", async () => {
    formsResult = { ok: false, message: "upstream said 503" };

    const html = await render();

    expect(html).not.toMatch(LIST_ELEMENT);
    // Nor the sentence: a failed read does not know whether forms exist.
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
