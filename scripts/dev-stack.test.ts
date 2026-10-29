import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_READ_PATHS,
  apiChildEnv,
  descendantsOf,
  frontendChildEnv,
  kitchenSinkQuestions,
  reapChildTree,
  stackChildEnvs,
} from "./dev-stack.mjs";
import { stablePort } from "./ports.mjs";

/** Shapes, not credentials: none of these authenticates anything that exists. */
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
    // ADR-35 keeps the database out of the admin, and the environment is the one route
    // an import test cannot see.
    const admin = frontendChildEnv("admin", frontendInputs);
    expect(admin.DATABASE_URL).toBeUndefined();
    expect(admin.QCMS_ADMIN_AUTH_SECRET).toBeUndefined();
    // The exhaustive list, so a fifth key is a question to answer rather than a line to
    // update here.
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
    expect(frontendChildEnv("admin", frontendInputs).QCMS_ADMIN_BASE_URL).toBe(
      apiChildEnv(inputs).QCMS_ADMIN_BASE_URL,
    );
  });
});

describe("every fixture the seed reads still exists", () => {
  const repoRoot = new URL("../", import.meta.url);

  it("lists both halves of the kitchen-sink form and one path per pinned question", () => {
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

describe("the dev seed's questions come from the form it publishes (issue #817 class)", () => {
  const repoRoot = new URL("../", import.meta.url);
  const DEFINITION = "apps/api/e2e/support/fixtures/vehicle-kitchen-sink-form.json";

  function pinnedByTheForm(): Map<string, number> {
    const definition = JSON.parse(readFileSync(new URL(DEFINITION, repoRoot), "utf8")) as {
      steps: { items: { questionId: string; version: number }[] }[];
    };
    const highest = new Map<string, number>();
    for (const step of definition.steps) {
      for (const item of step.items) {
        highest.set(item.questionId, Math.max(highest.get(item.questionId) ?? 0, item.version));
      }
    }
    return highest;
  }

  it("seeds exactly the questions the form pins, at the versions it pins them", () => {
    // Read from the file here, not through the module, so this compares two independent
    // reads rather than the derivation with itself.
    const expected = pinnedByTheForm();
    const seeded = new Map(kitchenSinkQuestions().map((q) => [q.id, q.versions]));
    expect(seeded).toEqual(expected);
    // Non-vacuity: the fixture carries more than one question, and one pinned above 1.
    expect(expected.size).toBeGreaterThan(1);
    expect([...expected.values()]).toContain(2);
  });

  it("gives every seeded question a definition file that exists", () => {
    for (const question of kitchenSinkQuestions()) {
      expect(existsSync(new URL(question.path, repoRoot)), `${question.path} is missing`).toBe(
        true,
      );
      expect(question.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("refuses a form that pins a question the launcher has no definition path for", () => {
    expect(() =>
      kitchenSinkQuestions({ steps: [{ items: [{ questionId: "q_brand_new", version: 1 }] }] }),
    ).toThrow(/q_brand_new/);
  });

  it("refuses a definition path for a question the form no longer pins", () => {
    expect(() =>
      kitchenSinkQuestions(
        { steps: [{ items: [{ questionId: "q_kept", version: 1 }] }] },
        {
          q_kept: { slug: "kept", path: "packages/core/fixtures/questions/valid/date.json" },
          q_dropped: { slug: "dropped", path: "packages/core/fixtures/questions/valid/date.json" },
        },
      ),
    ).toThrow(/q_dropped/);
  });
});

describe("the admin's port is derived, never written down (R8)", () => {
  it("puts the admin on this seat's 7S40", () => {
    expect(stablePort("admin", 6)).toBe(7640);
    expect(stablePort("admin", 0)).toBe(7040);
  });
});

describe("the admin banner never echoes a database credential (SEC-8)", () => {
  /** Deliberately fake: neither authenticates anything that exists. */
  const FAKE_URL_PASSWORD = "hunter2-NOT-A-REAL-PASSWORD";
  const FAKE_DB_PASSWORD = "swordfish-NOT-A-REAL-PASSWORD";
  const PLACEHOLDER = "DATABASE_URL=<your dev database URL>";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Fresh import per case: the module reads its environment once, at import. */
  async function banner(): Promise<string> {
    vi.resetModules();
    const module = await import("./dev-stack.mjs");
    return module.adminBannerLines().join("\n");
  }

  it("suppresses the line when DATABASE_URL is supplied by the environment", async () => {
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
    // Non-vacuity: suppressing unconditionally would pass both cases above.
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("QCMS_DB_PASSWORD", undefined);
    const text = await banner();
    expect(text).not.toContain(PLACEHOLDER);
    expect(text).toMatch(/DATABASE_URL=postgres:\/\/qcms:qcms@/);
  });
});

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
    // Asserted against the derived port, not an input this test chose, so swapping the
    // two constants at the call site cannot pass.
    expect(envs.frontend.QCMS_ADMIN_BASE_URL).toBe(`http://localhost:${stablePort("admin")}`);
    expect(envs.frontend.QCMS_ADMIN_BASE_URL).not.toBe(`http://localhost:${stablePort("portal")}`);
    expect(envs.api.QCMS_ADMIN_BASE_URL).toBe(envs.frontend.QCMS_ADMIN_BASE_URL);
  });

  it("still gives the API the portal origin it builds links against", () => {
    const envs = stackChildEnvs({ frontend: "admin", internalToken: TOKEN });
    expect(envs.api.QCMS_PORTAL_BASE_URL).toBe(`http://localhost:${stablePort("portal")}`);
  });
});

describe("Ctrl+C reaps the whole front-end tree (issue #318)", () => {
  const SHELL = ["/bin/sh", "/usr/bin/sh"].find((candidate) => existsSync(candidate));
  const itOnPosix = process.platform !== "win32" && SHELL !== undefined ? it : it.skip;

  /** Polled: a signalled process may be a zombie for a moment before the pid goes. */
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
      // `sh` stands in for `pnpm --filter <app> dev`: it does not forward SIGTERM to what
      // it spawned.
      const child = spawn(SHELL as string, ["-c", "sleep 30 & sleep 30 & wait"]);
      await once(child, "spawn");
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
      // Asserted in a separate process: the pids only become orphans once the launcher
      // that started them is gone, and the reap runs in its `exit` handler.
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
      // `process.kill()` does not know a pid is spent, so it would signal whatever holds
      // that number now.
      const child = spawn(SHELL as string, ["-c", "exit 0"]);
      await once(child, "exit");
      expect(child.exitCode ?? child.signalCode).not.toBeNull();
      expect(reapChildTree(child)).toEqual([]);
    },
    20_000,
  );
});
