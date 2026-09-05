import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_READ_PATHS,
  apiChildEnv,
  descendantsOf,
  frontendChildEnv,
  reapChildTree,
  stackChildEnvs,
} from "./dev-stack.mjs";
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
    // The whole list, not just the two absences above, because the claim is that this
    // service's configuration is small enough to read: an API address, the SEC-4 token,
    // its own origin, and the portal's. A fifth key arriving is a question to answer
    // rather than a line to update.
    //
    // `QCMS_PORTAL_BASE_URL` joined on 2026-08-26 so the builder can show a published
    // form's public address. It is read-only in the strongest sense: the admin makes no
    // request to the portal with it, it writes the URL down for an operator to hand out.
    expect(Object.keys(admin).toSorted()).toEqual([
      "NODE_ENV",
      "QCMS_ADMIN_BASE_URL",
      "QCMS_API_BASE_URL",
      "QCMS_INTERNAL_TOKEN",
      "QCMS_PORTAL_BASE_URL",
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

/**
 * The seed's read sites, derived rather than restated (issue #817).
 *
 * `pnpm dev:admin` and `pnpm dev:portal` were both dead on `main` for as long as it
 * took someone to run one: PR #779 (#129) renamed the kitchen-sink fixtures to
 * `vehicle-kitchen-sink-*`, the rename swept `apps/api/e2e` but not `scripts/`, and
 * the seeder threw ENOENT before the API started. Nothing caught it because nothing
 * in `verify` executes this launcher and `scripts/**` has no typecheck.
 *
 * A path this module reads is now in `FIXTURE_READ_PATHS`, so this test fails the
 * moment a fixture moves - which is the cheapest place in the repository to learn it.
 */
describe("every fixture the seed reads still exists", () => {
  const repoRoot = new URL("../", import.meta.url);

  it("lists both halves of the kitchen-sink form and one path per pinned question", () => {
    // A guard on the derivation itself: an empty or truncated list would pass the
    // loop below while asserting nothing at all.
    expect(FIXTURE_READ_PATHS.length).toBeGreaterThanOrEqual(9);
    expect(FIXTURE_READ_PATHS).toContain(
      "apps/api/e2e/support/fixtures/vehicle-kitchen-sink-form.json",
    );
    expect(FIXTURE_READ_PATHS).toContain(
      "apps/api/e2e/support/fixtures/vehicle-kitchen-sink.a2ui.json",
    );
  });

  it.each(FIXTURE_READ_PATHS)("resolves %s", (relativePath) => {
    expect(existsSync(new URL(relativePath, repoRoot)), `${relativePath} does not exist`).toBe(
      true,
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

/**
 * The call site, which is what the assertions above cannot reach.
 *
 * `apiChildEnv` and `frontendChildEnv` are pure, so calling them with hand-written
 * inputs proves only that they copy their arguments through. Both of the mutations
 * that would break issue #281's premise live one level up, at the site that decides
 * what to pass, and every test above stays green under either of them:
 *
 *   1. handing the front end a fresh `randomSecret()` instead of the API's token -
 *      which is the entire reason `pnpm dev:admin` starts its own API;
 *   2. passing `PORTAL_BASE_URL` where `ADMIN_BASE_URL` belongs.
 *
 * `stackChildEnvs` is that site. It takes the token once and reads the addresses from
 * the module's own seat-derived constants, so these assertions fail under either.
 */
describe("the launcher's call site, not just its pure helpers (issue #281)", () => {
  const TOKEN = "shared-token-for-this-run";

  it("builds both children from one and the same token", () => {
    const envs = stackChildEnvs({ frontend: "admin", internalToken: TOKEN });
    expect(envs.frontend.QCMS_INTERNAL_TOKEN).toBe(envs.api.QCMS_INTERNAL_TOKEN);
    expect(envs.frontend.QCMS_INTERNAL_TOKEN).toBe(TOKEN);
  });

  it("does the same for the portal", () => {
    const envs = stackChildEnvs({ frontend: "portal", internalToken: TOKEN });
    expect(envs.frontend.QCMS_INTERNAL_TOKEN).toBe(envs.api.QCMS_INTERNAL_TOKEN);
    expect(envs.frontend.QCMS_INTERNAL_TOKEN).toBe(TOKEN);
  });

  it("puts the admin on its own origin, which is not the portal's", () => {
    const envs = stackChildEnvs({ frontend: "admin", internalToken: TOKEN });
    // Asserted against the derived port rather than against an input this test chose,
    // so swapping the two constants at the call site cannot pass.
    expect(envs.frontend.QCMS_ADMIN_BASE_URL).toBe(`http://localhost:${stablePort("admin")}`);
    expect(envs.frontend.QCMS_ADMIN_BASE_URL).not.toBe(`http://localhost:${stablePort("portal")}`);
    // And the API, which reads it as better-auth's baseURL, agrees with the admin.
    expect(envs.api.QCMS_ADMIN_BASE_URL).toBe(envs.frontend.QCMS_ADMIN_BASE_URL);
  });

  it("still gives the API the portal origin it builds links against", () => {
    const envs = stackChildEnvs({ frontend: "admin", internalToken: TOKEN });
    expect(envs.api.QCMS_PORTAL_BASE_URL).toBe(`http://localhost:${stablePort("portal")}`);
  });
});

/**
 * The reaping path (issue #318), against a real process tree.
 *
 * This is the one part of the launcher with a genuine process in it, and it is the fix
 * #318 is about, so it is tested rather than left to the PR's manual evidence. A full
 * stack boot is not needed: what `reapChildTree` has to get right is generic - find the
 * grandchildren of a child that does not forward signals, signal them before their
 * parent, and refuse to signal anything for a child that has already exited. A shell
 * holding two `sleep`s is that shape, and costs milliseconds.
 */
describe("Ctrl+C reaps the whole front-end tree (issue #318)", () => {
  const SHELL = ["/bin/sh", "/usr/bin/sh"].find((candidate) => existsSync(candidate));
  const itOnPosix = process.platform !== "win32" && SHELL !== undefined ? it : it.skip;

  /** True once the pid is gone. A signalled process may be a zombie for a moment first. */
  async function waitUntilGone(pid: number): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  itOnPosix(
    "signals the grandchildren a plain child.kill() would orphan",
    async () => {
      // `sh` here stands in for `pnpm --filter <app> dev`: it does not forward SIGTERM to
      // what it spawned, so the two sleeps are exactly the `next-server` that used to be
      // left holding this seat's 7S00/7S40.
      const child = spawn(SHELL as string, ["-c", "sleep 30 & sleep 30 & wait"]);
      await once(child, "spawn");
      // Give the shell a moment to fork both sleeps before the snapshot is taken.
      let descendants: number[] = [];
      for (let attempt = 0; attempt < 100 && descendants.length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        descendants = descendantsOf(child.pid as number);
      }
      expect(descendants.length).toBeGreaterThanOrEqual(2);

      const signalled = reapChildTree(child);

      // Children before parents, so nothing is re-parented mid-walk.
      expect(signalled.at(-1)).toBe(child.pid);
      for (const pid of descendants) expect(signalled).toContain(pid);

      await once(child, "close");
      for (const pid of descendants) {
        expect(await waitUntilGone(pid), `pid ${pid} survived the reap`).toBe(true);
      }
    },
    20_000,
  );

  itOnPosix(
    "reaps the tree on an abnormal exit too, not only on a signal (issue #350)",
    async () => {
      // The half #281 left open. `shutdown()` reaped, so Ctrl+C was clean; `fail()`
      // called `process.exit(1)` and reaped nothing, so an API crash or a readiness
      // timeout left a `next-server` holding this seat's port - reparented to pid 1,
      // still listening, and adopted by the next `verify:browser` run.
      //
      // It has to be asserted in a SEPARATE process, because the property is about what
      // survives this launcher's death: the reap runs in a `process.on("exit")` handler,
      // and the pids only become orphans once that process is gone. So a child node
      // process builds the real wiring (`installShutdownHandlers` + `startChild`, both
      // from the module under test), reports the tree it created, and exits 1 the way
      // `fail()` does. Nothing here calls `reapChildTree`; if the handler is not wired,
      // the sleeps outlive their launcher and this fails.
      const script = `
        const stack = await import(${JSON.stringify(new URL("./dev-stack.mjs", import.meta.url).href)});
        stack.installShutdownHandlers();
        const child = stack.startChild("fixture", ${JSON.stringify(SHELL as string)}, ["-c", "sleep 30 & sleep 30 & wait"], {});
        let descendants = [];
        for (let attempt = 0; attempt < 100 && descendants.length < 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          descendants = stack.descendantsOf(child.pid);
        }
        process.stdout.write(JSON.stringify([child.pid, ...descendants]));
        process.exit(1);
      `;
      const launcher = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      let reported = "";
      launcher.stdout.on("data", (chunk: Buffer) => (reported += chunk.toString()));
      const [code] = (await once(launcher, "exit")) as [number | null, string | null];
      expect(code).toBe(1);

      const tree = JSON.parse(reported) as number[];
      // Two sleeps plus the shell, or the fixture never got far enough to prove anything.
      expect(tree.length).toBeGreaterThanOrEqual(3);
      for (const pid of tree) {
        expect(await waitUntilGone(pid), `pid ${pid} outlived the launcher that started it`).toBe(
          true,
        );
      }
    },
    30_000,
  );

  itOnPosix(
    "signals nothing for a child that has already exited",
    async () => {
      // The recycled-pid hazard. `child.kill()` is a no-op after exit because Node knows
      // the pid is spent; `process.kill()` does not, and would signal whatever holds that
      // number now. Without the guard this returns the dead pid instead of nothing.
      const child = spawn(SHELL as string, ["-c", "exit 0"]);
      await once(child, "exit");
      expect(child.exitCode ?? child.signalCode).not.toBeNull();
      expect(reapChildTree(child)).toEqual([]);
    },
    20_000,
  );
});
