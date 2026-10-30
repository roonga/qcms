import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OperationsFormRow } from "../../lib/ops/operations-forms.ts";
import type { ShellCapabilities } from "../../lib/shell/modes.ts";

/**
 * The six states the Operations forms table has to keep apart (the environment plan,
 * "Lists and filter boundaries"): no release, closed intake, no matching results, denied
 * access, a read in flight and a read that failed.
 *
 * At this layer rather than in Playwright for the reason `forms-list-states.test.tsx`
 * gives: the discovery read happens in the Next server process, so no `page.route()`
 * reaches it and nothing a browser controls can make it fail.
 *
 * `t` answers with its own key, so every assertion is about which string a branch chose.
 */

const SESSION = {
  userId: "u_1",
  email: "operator@example.test",
  name: "Operator",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const EVERYTHING: ShellCapabilities = {
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: true,
};

const NOTHING: ShellCapabilities = {
  authoring: false,
  operations: false,
  workspaces: false,
  siteConfiguration: false,
};

const RELEASED: OperationsFormRow = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  displayName: "Intake",
  workspace: { workspaceId: "ws_1", slug: "core", name: "Core" },
  hasRelease: true,
  release: { version: 4, releasedAt: "2026-10-01T00:00:00.000Z", closed: false },
  lastReleaseAt: "2026-10-01T00:00:00.000Z",
  counts: { submitted: 7, inProgress: 2 },
  capabilities: ["response:read"],
};

const UNRELEASED: OperationsFormRow = {
  ...RELEASED,
  formId: "frm_draft_only",
  slug: "draft-only",
  displayName: "draft-only",
  hasRelease: false,
  release: null,
  lastReleaseAt: null,
  counts: null,
};

const CLOSED: OperationsFormRow = {
  ...RELEASED,
  formId: "frm_closed",
  slug: "closed",
  displayName: "Closed",
  release: { version: 2, releasedAt: "2026-09-01T00:00:00.000Z", closed: true },
};

/** Set per case before the page renders; one set of module mocks serves every state. */
let capabilities: ShellCapabilities = EVERYTHING;
let listResult: unknown = { status: "ok", page: page([]) };

function page(rows: readonly OperationsFormRow[], nextCursor: string | null = null) {
  return {
    environment: "test",
    forms: rows,
    total: rows.length,
    nextCursor,
    workspaces: [{ workspaceId: "ws_1", slug: "core", name: "Core" }],
  };
}

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/shell", () => ({
  shellAccess: () => Promise.resolve({ status: "known", capabilities }),
  navigableCapabilities: () => capabilities,
}));
vi.mock("@/lib/server/environments", () => ({
  resolvedEnvironment: () =>
    Promise.resolve({
      status: "known",
      environment: "test",
      environments: ["test", "prod"],
      selection: "test",
    }),
}));
vi.mock("@/lib/server/operations", () => ({
  listOperationsForms: () => Promise.resolve(listResult),
}));
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
}));

async function render(params: Record<string, string> = {}): Promise<string> {
  const { default: OperationsPage } = await import("./operations/page.tsx");
  return renderToStaticMarkup(await OperationsPage({ searchParams: Promise.resolve(params) }));
}

describe("the Operations forms table's states", () => {
  it("offers a recovery and no table to a caller who does not hold the area", async () => {
    capabilities = NOTHING;

    const html = await render();

    expect(html).toContain('data-testid="qcms-denied-recovery"');
    expect(html).not.toContain('data-testid="qcms-operations-table"');
    // It names nothing it refused, the environment included.
    expect(html).not.toContain('data-testid="qcms-operations-environment"');
  });

  it("renders the alert and nothing else when the discovery read fails", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "failed", message: "upstream said 503" };

    const html = await render();

    expect(html).toContain("operations.loadFailed");
    // An API failure is never an empty installation.
    expect(html).not.toContain('data-testid="qcms-operations-empty"');
    expect(html).not.toContain('data-testid="qcms-operations-table"');
  });

  it("tells a refusal from a failure, and renders the panel rather than the alert", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "denied" };

    const html = await render({ q: "nothing" });

    expect(html).toContain("operations.empty.title");
    expect(html).not.toContain("operations.loadFailed");
    // A refusal is not a filtered result either: the clear link would change nothing.
    expect(html).not.toContain("operations.empty.filtered");
  });

  it("offers the access route when an unfiltered read comes back with nothing", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "ok", page: page([]) };

    const html = await render();

    expect(html).toContain("operations.empty.title");
    expect(html).toContain("operations.empty.body");
    expect(html).not.toContain("rail.filters.clear");
  });

  it("offers the clear link, and drops the explanation, when a filter matched nothing", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "ok", page: page([]) };

    const html = await render({ q: "nothing", env: "test" });

    expect(html).toContain("operations.empty.filtered");
    expect(html).not.toContain("operations.empty.body");
    expect(html).toContain('href="/operations?env=test"');
  });

  it("separates no release from closed intake, and masks what the caller cannot count", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "ok", page: page([RELEASED, UNRELEASED, CLOSED]) };

    const html = await render();

    expect(html).toContain('data-testid="qcms-operations-table"');
    expect(html).toContain("operations.intake.open");
    expect(html).toContain("operations.intake.closed");
    expect(html).toContain("operations.intake.unreleased");
    expect(html).toContain("operations.release.none");
    // The unreleased row holds no counts, so both of its count cells read as nothing.
    expect(html).toContain("ops.common.none");
  });

  it("links each row to its form and offers the next page only when there is one", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "ok", page: page([RELEASED]) };

    expect(await render()).not.toContain('data-testid="qcms-operations-pager"');

    listResult = { status: "ok", page: page([RELEASED], "cur2") };
    const html = await render({ env: "test", q: "in" });

    expect(html).toContain('href="/forms/frm_intake"');
    expect(html).toContain('data-testid="qcms-operations-pager"');
    expect(html).toContain("cursor=cur2");
    // The page position rides with the filters rather than replacing them.
    expect(html).toContain("q=in");
  });

  it("names the environment as an address, with the selected one marked", async () => {
    capabilities = EVERYTHING;
    listResult = { status: "ok", page: page([RELEASED]) };

    const html = await render({ env: "test" });

    expect(html).toContain('data-environment="test"');
    expect(html).toContain('href="/operations?env=prod"');
    expect(html).toContain('aria-current="true"');
  });
});

describe("the state while the read is in flight", () => {
  it("says the forms are loading, and keeps the heading the page's own", async () => {
    const { default: OperationsLoading } = await import("./operations/loading.tsx");

    const html = renderToStaticMarkup(<OperationsLoading />);

    expect(html).toContain('data-testid="qcms-operations-loading"');
    expect(html).toContain("operations.loading");
    expect(html).toContain("shell.mode.operations.name");
    expect(html).toContain('role="status"');
  });
});
