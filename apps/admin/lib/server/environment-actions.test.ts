import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedEnvironment } from "../environment.ts";
import { t } from "../i18n/en.ts";

/**
 * Every environment-sensitive server action refuses to act in an environment its screen
 * did not show (local UX list A1).
 *
 * The defect this pins was reproduced live: tab A rendered "Close it in prod", tab B
 * switched the shared cookie to `test`, and confirming in tab A closed the form in `test`.
 * Each action now takes the environment its page rendered, bound next to the form id, and
 * `confirmShownEnvironment` compares it with the request's one resolution before anything
 * is forwarded.
 *
 * ## The seam
 *
 * `requestEnvironment` in `lib/server/api.ts` is faked, because it reads a cookie and the
 * API's live set; everything above it (`environments.ts`'s check, `lib/environment.ts`'s
 * rule, and the three action modules) runs as shipped. The `lib/server` modules that would
 * reach the API are faked with a counter each, and the assertion that matters is that the
 * counter did not move: a refused action must not have sent anything.
 *
 * The file lives under `lib/` for the reason `lib/forms/actions.test.ts` gives: `app/` is
 * route-scanned by Next.
 */

/** What the request resolves to; set before each test. Hoisted, so it cannot name the type. */
const current = vi.hoisted((): { value: unknown } => ({ value: undefined }));

const sent = vi.hoisted(() => ({ count: 0, environments: [] as string[], resolutions: 0 }));

/** One forwarded call, and the environment it named when it named one. */
function forwarded(environment?: string): Promise<unknown> {
  sent.count += 1;
  if (environment !== undefined) sent.environments.push(environment);
  return Promise.resolve({ ok: true, data: {} });
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () =>
    Promise.resolve({
      userId: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: true,
      mustChangePassword: false,
      token: "session-token-for-this-test-only",
    }),
}));
vi.mock("@/lib/server/api", () => ({
  requestEnvironment: () => {
    sent.resolutions += 1;
    return Promise.resolve(current.value);
  },
  adminApiFetch: () => {
    throw new Error("no API call is expected from this file");
  },
}));
vi.mock("@/lib/server/forms", () => ({
  setFormStatus: (_s: unknown, _f: string, _a: string, environment: string) =>
    forwarded(environment).then(() => ({ ok: true, data: { status: "closed", environment } })),
}));
vi.mock("@/lib/server/links", () => ({
  MAX_LINK_BATCH: 100,
  mintLinks: (_s: unknown, _f: string, request: { environment: string }) =>
    forwarded(request.environment).then(() => ({ ok: true, data: [] })),
  revokeLink: () => forwarded().then(() => ({ ok: true, data: { linkId: "lnk_1" } })),
}));
// The wizard's own calls bind no environment and are deliberately absent from the table
// below: the destinations are chosen in its body and authorised again at commit.
vi.mock("@/lib/server/releases", () => ({
  releaseVersion: (_s: unknown, _f: string, input: { environment: string }) =>
    forwarded(input.environment),
  publishBatch: () => Promise.resolve({ ok: true, data: { version: 2, releases: [] } }),
  releaseBatch: () => Promise.resolve({ ok: true, data: { version: 2, releases: [] } }),
  lookupReleaseBatch: () => Promise.resolve({ ok: true, data: { version: 2, releases: [] } }),
  reviewRelease: () => Promise.resolve({ ok: true, data: { targets: [] } }),
}));
vi.mock("@/lib/server/responses", () => ({
  eraseSession: () => forwarded(),
  unflagResponse: () => forwarded().then(() => ({ ok: true, data: { released: true } })),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  createWebhook: () => forwarded(),
  rotateWebhookSecret: () => forwarded(),
  deactivateWebhook: () => forwarded(),
  reactivateWebhook: () => forwarded(),
  retargetWebhook: () => forwarded(),
  redeliver: (_s: unknown, _f: string, _d: string, environment: string) => forwarded(environment),
}));

const forms = await import("../../app/(shell)/forms/actions.ts");
const responses = await import("../../app/(shell)/responses/actions.ts");
const webhooks = await import("../../app/(shell)/webhooks/actions.ts");

/**
 * Every environment-sensitive action, called as its page binds it with `shown` as the
 * environment that page rendered. One table, so an action added to the list is checked by
 * every case below rather than by whichever one its author remembered.
 */
const ACTIONS: readonly {
  readonly name: string;
  readonly run: (shown: string | undefined) => Promise<{ status: string; message?: string }>;
}[] = [
  { name: "release", run: (shown) => forms.releaseVersionAction("frm_a", shown, { version: 1 }) },
  { name: "close", run: (shown) => forms.setFormStatusAction("frm_a", shown, "close") },
  { name: "reopen", run: (shown) => forms.setFormStatusAction("frm_a", shown, "reopen") },
  {
    name: "mint",
    run: (shown) =>
      forms.mintLinksAction("frm_a", shown, { expiresAt: "2030-01-01", oneTime: false, count: 1 }),
  },
  { name: "revoke", run: (shown) => forms.revokeLinkAction("frm_a", shown, "lnk_1") },
  {
    name: "erase",
    run: (shown) => responses.eraseSessionAction("frm_a", shown, "ses_1", "subject_request"),
  },
  { name: "unflag", run: (shown) => responses.unflagResponseAction("frm_a", shown, "ses_1") },
  {
    name: "create webhook",
    run: (shown) =>
      webhooks.createWebhookAction("frm_a", shown, { url: "https://x.test", active: true }),
  },
  { name: "rotate secret", run: (shown) => webhooks.rotateSecretAction("frm_a", shown, "whk_1") },
  {
    name: "deactivate webhook",
    run: (shown) => webhooks.deactivateWebhookAction("frm_a", shown, "whk_1"),
  },
  {
    name: "reactivate webhook",
    run: (shown) => webhooks.reactivateWebhookAction("frm_a", shown, "whk_1"),
  },
  {
    name: "retarget webhook",
    run: (shown) => webhooks.retargetWebhookAction("frm_a", shown, "whk_1", "https://y.test"),
  },
  { name: "redeliver", run: (shown) => webhooks.redeliverAction(shown, "frm_a", "dlv_1") },
  {
    name: "redeliver all",
    run: (shown) => webhooks.redeliverAllAction(shown, [{ formId: "frm_a", deliveryId: "dlv_1" }]),
  },
];

function resolvedTo(environment: string): ResolvedEnvironment {
  return { status: "known", environment, environments: ["prod", "test"], selection: environment };
}

beforeEach(() => {
  sent.count = 0;
  sent.environments = [];
  sent.resolutions = 0;
  current.value = resolvedTo("prod");
});

describe.each(ACTIONS)("$name", ({ run }) => {
  it("refuses, sending nothing, when another tab has switched the environment", async () => {
    // Tab A rendered prod; tab B has since switched the shared cookie to test.
    current.value = resolvedTo("test");

    const state = await run("prod");

    expect(state.status).toBe("error");
    expect(state.message).toBe(t("environment.switched", { shown: "prod", current: "test" }));
    expect(sent.count).toBe(0);
  });

  it("refuses the reverse direction too, which is the dangerous one", async () => {
    // A dialog naming test must never act in prod.
    current.value = resolvedTo("prod");

    const state = await run("test");

    expect(state.status).toBe("error");
    expect(state.message).toBe(t("environment.switched", { shown: "test", current: "prod" }));
    expect(sent.count).toBe(0);
  });

  it("refuses when the environment cannot be confirmed", async () => {
    current.value = { status: "unknown", selection: "test" };

    const state = await run("test");

    expect(state.message).toBe(t("environment.unconfirmed"));
    expect(sent.count).toBe(0);
  });

  it("refuses a screen that rendered without a confirmed environment", async () => {
    const state = await run(undefined);

    expect(state.message).toBe(t("environment.unconfirmed"));
    expect(sent.count).toBe(0);
  });

  it("acts when the screen showed the environment the request resolves to", async () => {
    current.value = resolvedTo("test");

    const state = await run("test");

    expect(state.status).not.toBe("error");
    expect(sent.count).toBeGreaterThan(0);
    // Where the call names its environment, it names the one that was shown.
    expect(sent.environments.every((environment) => environment === "test")).toBe(true);
  });
});

describe("a release bound to the selected environment", () => {
  it("refuses a stale production confirmation after another tab switches to test", async () => {
    current.value = resolvedTo("test");
    const result = await forms.releaseVersionAction("frm_a", "prod", { version: 1 });
    expect(result.status).toBe("error");
    expect(sent.count).toBe(0);
  });
  it("releases into the shown environment when the caller names no destination", async () => {
    current.value = resolvedTo("test");
    await forms.releaseVersionAction("frm_a", "test", { version: 1 });
    expect(sent.count).toBe(1);
    expect(sent.environments).toEqual(["test"]);
  });

  // A promotion names where it lands, which is what lets one plan span two environments.
  // The destination is still authorised against the caller's own cell at the API.
  it("releases into the named destination while the tab stays coherent with the selection", async () => {
    current.value = resolvedTo("test");
    const state = await forms.releaseVersionAction("frm_a", "test", {
      version: 3,
      environment: "prod",
    });
    expect(state.status).not.toBe("error");
    expect(sent.environments).toEqual(["prod"]);
  });

  it("refuses a named destination on a tab whose selection has moved", async () => {
    current.value = resolvedTo("test");
    const state = await forms.releaseVersionAction("frm_a", "prod", {
      version: 3,
      environment: "prod",
    });
    expect(state.status).toBe("error");
    expect(sent.count).toBe(0);
  });
});

describe("redeliver all", () => {
  it("resolves the environment once for the whole batch, and names it on every row", async () => {
    const targets = ["dlv_1", "dlv_2", "dlv_3"].map((deliveryId) => ({
      formId: "frm_a",
      deliveryId,
    }));

    await webhooks.redeliverAllAction("prod", targets);

    expect(sent.resolutions).toBe(1);
    expect(sent.environments).toEqual(["prod", "prod", "prod"]);
  });
});
