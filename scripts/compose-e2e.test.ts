import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  composeEnvironmentOverrides,
  harnessSecrets,
  pnpmInvocation,
  joinComposeNetwork,
  soleNetworkName,
  soleTcpPort,
} from "./compose-e2e.mjs";

/**
 * The seat must be refused before anything spawns: adopting seat 0 would make teardown delete another
 * lane's stack. The whole `scripts/` directory is copied into each throwaway root because a module list goes stale.
 */

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function checkout(kind: "worktree" | "primary"): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-compose-e2e-"));
  roots.push(root);
  cpSync(SCRIPTS, join(root, "scripts"), { recursive: true });
  if (kind === "worktree")
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
  else mkdirSync(join(root, ".git"));
  return root;
}

function runWithoutSeat(root: string, args: string[]): { status: number | null; stderr: string } {
  const environment = { ...process.env };
  delete environment.QCMS_PORT_SEAT;
  const result = spawnSync(process.execPath, [join(root, "scripts", "compose-e2e.mjs"), ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

describe("compose-e2e seat refusal", () => {
  it("refuses an unset seat from a linked worktree, naming the variable and the doc", () => {
    const { status, stderr } = runWithoutSeat(checkout("worktree"), []);
    expect(status).toBe(1);
    expect(stderr).toContain("QCMS_PORT_SEAT");
    expect(stderr).toContain("linked git worktree");
    expect(stderr).toContain("docs/PORTS.md");
  });

  it("names the command the reader was actually running", () => {
    const root = checkout("worktree");
    const cases: readonly (readonly [string[], string])[] = [
      [[], "pnpm up:e2e"],
      [["run"], "pnpm up:e2e"],
      [["up"], "pnpm docker:up"],
      [["down"], "pnpm docker:down"],
      [["test"], "pnpm test:e2e"],
      [["test-headed"], "pnpm test:e2e:headed"],
    ];
    for (const [args, expected] of cases) {
      const { stderr } = runWithoutSeat(root, args);
      expect(stderr).toContain(expected);
      expect(stderr).not.toContain("verify:browser");
    }
  });

  it("refuses before it dispatches the subcommand, so nothing is ever spawned", () => {
    const { status, stderr } = runWithoutSeat(checkout("worktree"), ["down"]);
    expect(status).toBe(1);
    expect(stderr).toContain("QCMS_PORT_SEAT");
    expect(stderr).not.toContain("docker compose");
    expect(stderr).not.toContain("exited with status");
  });

  it("prints the refusal without a stack trace", () => {
    const { stderr } = runWithoutSeat(checkout("worktree"), ["down"]);
    expect(stderr).not.toMatch(/\n\s+at /);
  });

  it("keeps the silent default in a primary checkout, which is also CI", () => {
    const { status, stderr } = runWithoutSeat(checkout("primary"), []);
    expect(status).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).not.toContain("QCMS_PORT_SEAT");
  });

  it("accepts an explicit seat from a worktree, including 0", () => {
    const root = checkout("worktree");
    for (const seat of ["0", "3"]) {
      const result = spawnSync(process.execPath, [join(root, "scripts", "compose-e2e.mjs")], {
        cwd: root,
        env: { ...process.env, QCMS_PORT_SEAT: seat },
        encoding: "utf8",
      });
      expect(result.stderr).toContain("Usage:");
      expect(result.stderr).not.toContain("linked git worktree");
    }
  });
});

describe("composeEnvironmentOverrides", () => {
  const ports = { portalPort: 17100, adminPort: 17140 };

  it("is the same in every environment, which is the whole safety property", () => {
    expect(composeEnvironmentOverrides(ports)).toEqual({
      QCMS_ADMIN_PORT: "17140",
      QCMS_PORTAL_PORT: "17100",
      QCMS_ADMIN_BASE_URL: "http://localhost:17140",
      QCMS_PORTAL_BASE_URL: "http://localhost:17100",
      QCMS_PORTAL_ENVIRONMENTS: "test",
    });
  });

  it("never downgrades the admin's Secure cookie flag", () => {
    // Turning this off would let a non-localhost origin store the admin cookie, and is
    // exactly the divergence from CI that must not happen.
    expect("QCMS_ADMIN_SECURE_COOKIES" in composeEnvironmentOverrides(ports)).toBe(false);
  });

  it("never touches the Compose bind address", () => {
    // Compose publishes to loopback so the authoring admin is not put on every network
    // the host can reach; the harness joins the Compose network instead of widening it.
    expect("QCMS_BIND_ADDRESS" in composeEnvironmentOverrides(ports)).toBe(false);
  });

  it("keeps the browsed origin on localhost, which browsers trust", () => {
    const { QCMS_ADMIN_BASE_URL, QCMS_PORTAL_BASE_URL } = composeEnvironmentOverrides(ports);
    for (const url of [QCMS_ADMIN_BASE_URL, QCMS_PORTAL_BASE_URL]) {
      expect(new URL(url).hostname).toBe("localhost");
    }
  });
});

describe("soleTcpPort", () => {
  it("reads the one exposed TCP port", () => {
    expect(soleTcpPort({ "3000/tcp": null }, "portal")).toBe(3000);
  });

  it("ignores a UDP port, which the forwarder could never use", () => {
    expect(soleTcpPort({ "5353/udp": null, "3000/tcp": null }, "portal")).toBe(3000);
  });

  it("refuses to guess between two TCP ports, naming the service and the candidates", () => {
    // Docker's key order is a string sort, so `10000/tcp` sorts before `3000/tcp`.
    expect(() => soleTcpPort({ "10000/tcp": null, "3000/tcp": null }, "admin")).toThrow(
      /admin exposes more than one TCP port \(10000\/tcp, 3000\/tcp\)/,
    );
  });

  it("refuses a container with no TCP port at all", () => {
    expect(() => soleTcpPort({ "5353/udp": null }, "portal")).toThrow(/exposes no TCP port/);
    expect(() => soleTcpPort({}, "portal")).toThrow(/exposes no TCP port/);
  });
});

describe("soleNetworkName", () => {
  it("reads the one network the service is on", () => {
    expect(soleNetworkName({ stack_default: { IPAddress: "172.20.0.5" } }, "portal")).toBe(
      "stack_default",
    );
  });

  it("refuses to guess between two networks", () => {
    expect(() => soleNetworkName({ a_net: {}, b_net: {} }, "portal")).toThrow(
      /portal is on more than one network \(a_net, b_net\)/,
    );
  });

  it("refuses a service on no network", () => {
    expect(() => soleNetworkName({}, "portal")).toThrow(/is on no network/);
  });
});

/**
 * A failed join must be fatal rather than swallowed: the forwarder still binds and
 * prints `ready`, so forwarded connections hit Docker's cross-bridge isolation and
 * time out instead of being refused.
 */
describe("joinComposeNetwork", () => {
  it("accepts a connect that failed because the endpoint was already there", () => {
    expect(() =>
      joinComposeNetwork("stack_default", "self", {
        connect: () => ({ failure: "endpoint with name self already exists in network" }),
        attached: () => ["stack_default"],
      }),
    ).not.toThrow();
  });

  it("throws naming the network when the connect really failed", () => {
    // `docker network connect` reports one failure for "already attached", "no such
    // network" and "no such container" alike, so only the read-back separates them.
    expect(() =>
      joinComposeNetwork("stack_default", "self", {
        connect: () => ({ failure: "Error response from daemon: network stack_default not found" }),
        attached: () => [],
      }),
    ).toThrow(/not attached to the Compose network stack_default/);
  });

  it("carries Docker's own reason into the error", () => {
    expect(() =>
      joinComposeNetwork("stack_default", "self", {
        connect: () => ({ failure: "Error response from daemon: No such container: self" }),
        attached: () => [],
      }),
    ).toThrow(/No such container: self/);
  });

  it("says what the swallowed failure would have cost, so the reader stops here", () => {
    expect(() =>
      joinComposeNetwork("stack_default", "self", {
        connect: () => ({}),
        attached: () => [],
      }),
    ).toThrow(/cross-bridge isolation/);
  });

  it("fails even when the connect reported success but the container is not attached", () => {
    expect(() =>
      joinComposeNetwork("stack_default", "self", { connect: () => ({}), attached: () => [] }),
    ).toThrow(/after docker network connect\./);
  });
});

describe("harness secrets (task 040)", () => {
  it("overrides every placeholder secret the example env file carries", () => {
    // The secret lines in `.env.compose.example` are placeholders the API refuses to
    // boot on, so each must be supplied here. Sorted, so a new one forces this list.
    expect(Object.keys(harnessSecrets()).sort()).toEqual([
      "QCMS_ADMIN_AUTH_SECRET",
      "QCMS_APP_KEY",
      "QCMS_INTERNAL_TOKEN",
      "QCMS_LINK_KEYS",
      "QCMS_SESSION_KEYS",
    ]);
  });

  it("generates hex, which cannot begin with a placeholder prefix by chance", () => {
    for (const value of Object.values(harnessSecrets())) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("calls the generator once per variable, so no two secrets share a value", () => {
    let n = 0;
    const secrets = harnessSecrets(() => `generated-${String(++n)}`);
    const values = Object.values(secrets);
    expect(new Set(values).size).toBe(values.length);
    expect(n).toBe(values.length);
  });

  it("draws a fresh set on every call rather than memoising one", () => {
    let n = 0;
    const generate = (): string => `generated-${String(++n)}`;
    const first = harnessSecrets(generate);
    const second = harnessSecrets(generate);
    expect(Object.values(first)).not.toEqual(Object.values(second));
    expect(first.QCMS_APP_KEY).not.toBe(second.QCMS_APP_KEY);
  });
});

describe("pnpmInvocation", () => {
  it("runs a JavaScript entry point through node", () => {
    expect(
      pnpmInvocation({ execPath: "/opt/pnpm/bin/pnpm.cjs", nodePath: "/usr/bin/node" }),
    ).toEqual({ command: "/usr/bin/node", prefix: ["/opt/pnpm/bin/pnpm.cjs"] });
  });

  it("runs a standalone binary directly, which is what issue #1176 was", () => {
    expect(pnpmInvocation({ execPath: "/usr/local/bin/pnpm" })).toEqual({
      command: "/usr/local/bin/pnpm",
      prefix: [],
    });
  });

  it("falls back to pnpm on PATH when no entry point was passed through", () => {
    expect(pnpmInvocation({ execPath: "", platform: "linux" })).toEqual({
      command: "pnpm",
      prefix: [],
    });
    expect(pnpmInvocation({ execPath: "  ", platform: "win32" })).toEqual({
      command: "pnpm.cmd",
      prefix: [],
    });
  });
});
