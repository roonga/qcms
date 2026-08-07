import { afterEach, describe, expect, it, vi } from "vitest";

import { apiChildEnv, frontendChildEnv } from "./dev-stack.mjs";
import { stablePort } from "./ports.mjs";

/**
 * The launcher's wiring, asserted where it is cheap (issue #281).
 *
 * `scripts/**` has no ESLint and no typecheck, and nothing in `verify` or
 * `verify:browser` executes this script at all - the gap `docs/RETRO.md` records under
 * `## 034`, where a green gate set shipped a `pnpm dev:portal` that could not boot. So
 * the two properties that would fail silently are pulled out into pure functions and
 * checked here. What is deliberately NOT asserted is anything needing a process: the
 * database, the API and `next dev` are what the evidence in the PR is for.
 */

/** A fixed, synthetic input set. None of these is a credential; they are shapes. */
const inputs = {
  databaseUrl: "postgres://qcms:qcms@10.0.0.1:7620/qcms",
  apiPort: "7610",
  portalBaseUrl: "http://localhost:7600",
  adminBaseUrl: "http://localhost:7640",
  internalToken: "internal-token-for-this-run",
  linkKeys: "link-keys",
  sessionKeys: "session-keys",
  appKey: "app-key",
  adminAuthSecret: "admin-auth-secret",
};

const frontendInputs = {
  apiBaseUrl: `http://127.0.0.1:${inputs.apiPort}`,
  internalToken: inputs.internalToken,
  portalBaseUrl: inputs.portalBaseUrl,
  adminBaseUrl: inputs.adminBaseUrl,
};

describe("the SEC-4 internal token is one value across the stack", () => {
  it("hands the API and the admin the same token", () => {
    // The whole reason `pnpm dev:admin` starts its own API instead of joining one:
    // the token is generated in memory per run and written nowhere, so the only way
    // two processes can agree on it is for one process to hand it to both.
    const api = apiChildEnv(inputs);
    const admin = frontendChildEnv("admin", frontendInputs);
    expect(admin.QCMS_INTERNAL_TOKEN).toBe(api.QCMS_INTERNAL_TOKEN);
    expect(admin.QCMS_INTERNAL_TOKEN).toBe(inputs.internalToken);
  });

  it("hands the API and the portal the same token", () => {
    const api = apiChildEnv(inputs);
    const portal = frontendChildEnv("portal", frontendInputs);
    expect(portal.QCMS_INTERNAL_TOKEN).toBe(api.QCMS_INTERNAL_TOKEN);
  });
});

describe("the admin child gets no database handle", () => {
  it("passes no DATABASE_URL and no auth secret to the admin", () => {
    // Task 056 took the database out of the admin (ADR-35), and
    // `apps/admin/lib/server/r2-import-surface.test.ts` guards the import side of it.
    // Handing one back through the ENVIRONMENT would re-entrench it somewhere no
    // import test can see, so it is asserted from this side too.
    const admin = frontendChildEnv("admin", frontendInputs);
    expect(admin.DATABASE_URL).toBeUndefined();
    expect(admin.QCMS_ADMIN_AUTH_SECRET).toBeUndefined();
    expect(Object.keys(admin).toSorted()).toEqual([
      "NODE_ENV",
      "QCMS_ADMIN_BASE_URL",
      "QCMS_API_BASE_URL",
      "QCMS_INTERNAL_TOKEN",
    ]);
  });

  it("keeps the database URL on the API, which is the one process that has it", () => {
    expect(apiChildEnv(inputs).DATABASE_URL).toBe(inputs.databaseUrl);
  });
});

describe("the two sides agree on the admin's own origin", () => {
  it("gives the API and the admin the same QCMS_ADMIN_BASE_URL", () => {
    // The admin reads it for the SEC-9 origin check; the API reads it as better-auth's
    // `baseURL` and sole trusted origin. A disagreement is a sign-in that appears to
    // succeed and bounces.
    expect(frontendChildEnv("admin", frontendInputs).QCMS_ADMIN_BASE_URL).toBe(
      apiChildEnv(inputs).QCMS_ADMIN_BASE_URL,
    );
  });
});

describe("the admin's port is derived, never written down (R8)", () => {
  it("puts the admin on this seat's 7S40", () => {
    expect(stablePort("admin", 6)).toBe(7640);
    expect(stablePort("admin", 0)).toBe(7040);
  });
});

/**
 * SEC-8 at the output.
 *
 * The banner offers a ready-to-paste `pnpm qcms:create-admin` command, and a connection
 * string carries a password. That is safe for exactly one string: the one this module
 * builds itself from known-synthetic parts. Every route where the environment supplied
 * the credential instead has to fall back to the placeholder.
 *
 * Asserted against the whole rendered banner rather than the helper, because what
 * matters is that the developer never SEES the value. The module reads its environment
 * once at import, so each case resets the module registry and imports it afresh.
 */
describe("the admin banner never echoes a database credential (SEC-8)", () => {
  /** Recognisably fake. Neither is a credential for anything that exists. */
  const FAKE_URL_PASSWORD = "hunter2-NOT-A-REAL-PASSWORD";
  const FAKE_DB_PASSWORD = "swordfish-NOT-A-REAL-PASSWORD";
  const PLACEHOLDER = "DATABASE_URL=<your dev database URL>";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The rendered banner, from a fresh import under the currently stubbed environment. */
  async function banner(): Promise<string> {
    vi.resetModules();
    const module = await import("./dev-stack.mjs");
    return module.adminBannerLines().join("\n");
  }

  it("suppresses the line when DATABASE_URL is supplied by the environment", async () => {
    // The route the first version of this guard missed. `DATABASE_URL` is a supported
    // override, so a developer can point the launcher at a database whose password this
    // process did not invent - and the old guard only inspected `QCMS_DB_PASSWORD`.
    vi.stubEnv("DATABASE_URL", `postgres://qcms:${FAKE_URL_PASSWORD}@db.internal:5432/qcms`);
    const text = await banner();
    expect(text).not.toContain(FAKE_URL_PASSWORD);
    expect(text).toContain(PLACEHOLDER);
  });

  it("suppresses the line when QCMS_DB_PASSWORD is supplied by the environment", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("QCMS_DB_PASSWORD", FAKE_DB_PASSWORD);
    const text = await banner();
    expect(text).not.toContain(FAKE_DB_PASSWORD);
    expect(text).toContain(PLACEHOLDER);
  });

  it("still prints the ready-to-paste line for the synthetic compose default", async () => {
    // The guard must not be always-off: suppressing unconditionally would pass both
    // assertions above while quietly removing the thing the banner exists to offer.
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("QCMS_DB_PASSWORD", undefined);
    const text = await banner();
    expect(text).not.toContain(PLACEHOLDER);
    expect(text).toMatch(/DATABASE_URL=postgres:\/\/qcms:qcms@/);
  });
});
