import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  composeEnvironmentOverrides,
  joinComposeNetwork,
  soleNetworkName,
  soleTcpPort,
} from "./compose-e2e.mjs";

/**
 * The full-stack Compose harness must refuse an unset seat from a linked worktree
 * (issue #296), and it must refuse it BEFORE it spawns anything.
 *
 * That ordering is the whole point. `scripts/compose-e2e.mjs` derives its Compose
 * project name from the seat and runs `docker compose down --volumes
 * --remove-orphans` under it on teardown, so a run that silently adopted seat 0
 * would not merely read another lane's stack, it would delete it.
 *
 * The checkout kind is what decides the outcome, and this suite has to control it
 * rather than inherit it: the same assertion would pass vacuously in the primary
 * checkout and fail in a worktree. So each case gets a throwaway root holding a copy
 * of `scripts/`, with `.git` written as a FILE (a linked worktree) or as a DIRECTORY
 * (a primary checkout, and what CI checks out).
 *
 * The whole directory is copied rather than a named list of modules, and that is a
 * correction rather than laziness. A hand-kept list has to be updated whenever the
 * harness gains an import, and forgetting is not a readable failure: the copied
 * script dies in Node's module resolver, so all five assertions below report a
 * missing specifier instead of anything about seats. Copying the directory cannot
 * drift.
 *
 * Both cases are driven with an argv the script rejects anyway, so neither can reach
 * Docker even if the refusal were missing: a missing seat must produce the seat
 * error, and a present `.git` directory must produce the ordinary usage error.
 */

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repo root carrying the real scripts and the requested `.git` shape. */
function checkout(kind: "worktree" | "primary"): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-compose-e2e-"));
  roots.push(root);
  cpSync(SCRIPTS, join(root, "scripts"), { recursive: true });
  if (kind === "worktree")
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
  else mkdirSync(join(root, ".git"));
  return root;
}

/** Run the copied harness with no seat in the environment, and collect stderr. */
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
    // The browser harness says `pnpm verify:browser`; this one has to say its own,
    // or the fix offered does not match the failure in front of the reader. Each
    // subcommand maps to the script it is reached through, rather than every refusal
    // recommending the self-contained entry point whatever was run.
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
    // `down` is the destructive one. It must not reach Docker on a seatless worktree
    // run, which this proves by getting the seat error instead of a Docker error.
    const { status, stderr } = runWithoutSeat(checkout("worktree"), ["down"]);
    expect(status).toBe(1);
    expect(stderr).toContain("QCMS_PORT_SEAT");
    expect(stderr).not.toContain("docker compose");
    expect(stderr).not.toContain("exited with status");
  });

  it("prints the refusal without a stack trace", () => {
    // The convention two lines away in the script: a user error prints its message.
    // A stack trace on "you forgot a variable" buries the one line that matters.
    const { stderr } = runWithoutSeat(checkout("worktree"), ["down"]);
    expect(stderr).not.toMatch(/\n\s+at /);
  });

  it("keeps the silent default in a primary checkout, which is also CI", () => {
    // Seat 0 has to stay byte-identical for an existing developer and for the
    // workflow. With no subcommand the script still fails, but on usage, not on the
    // seat: that is the difference this case exists to pin.
    const { status, stderr } = runWithoutSeat(checkout("primary"), []);
    expect(status).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).not.toContain("QCMS_PORT_SEAT");
  });

  it("accepts an explicit seat from a worktree, including 0", () => {
    // What is refused is silence, not the value.
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
    // `full-stack-e2e` exists to catch auth-boundary regressions, and while CI is
    // down a local pass is the only evidence there is. If anything here varied by
    // environment, the local run would exercise a different configuration than CI
    // and quietly stop covering what it is run for. There is no environment input.
    expect(composeEnvironmentOverrides(ports)).toEqual({
      QCMS_ADMIN_PORT: "17140",
      QCMS_PORTAL_PORT: "17100",
      QCMS_ADMIN_BASE_URL: "http://localhost:17140",
      QCMS_PORTAL_BASE_URL: "http://localhost:17100",
    });
  });

  it("never downgrades the admin's Secure cookie flag", () => {
    // The rejected repair for #316. A Secure cookie can only be stored by a
    // trustworthy origin, so browsing a gateway address needs this off - and turning
    // it off is precisely the divergence from CI that must not happen. The origin
    // stays localhost instead, and this key must never appear.
    expect("QCMS_ADMIN_SECURE_COOKIES" in composeEnvironmentOverrides(ports)).toBe(false);
  });

  it("never touches the Compose bind address", () => {
    // docker-compose.yml publishes to loopback so the authoring admin is not put on
    // every network the host can reach. That exposure property is not tradeable, so
    // the harness reaches the stack over the Compose network instead of widening it.
    expect("QCMS_BIND_ADDRESS" in composeEnvironmentOverrides(ports)).toBe(false);
  });

  it("keeps the browsed origin on localhost, which browsers trust", () => {
    const { QCMS_ADMIN_BASE_URL, QCMS_PORTAL_BASE_URL } = composeEnvironmentOverrides(ports);
    for (const url of [QCMS_ADMIN_BASE_URL, QCMS_PORTAL_BASE_URL]) {
      expect(new URL(url).hostname).toBe("localhost");
    }
  });
});

/**
 * Reading the endpoint out of `docker inspect` (issue #335).
 *
 * Both of these replaced `Object.keys(...)[0]`, which was right by Docker's Go map
 * serialization sorting keys lexicographically rather than by anything this harness
 * chose. The point of the change is that a shape it cannot resolve now FAILS at
 * `up()`, naming the service, instead of forwarding a wrong number and surfacing as a
 * Playwright timeout.
 */
describe("soleTcpPort", () => {
  it("reads the one exposed TCP port", () => {
    expect(soleTcpPort({ "3000/tcp": null }, "portal")).toBe(3000);
  });

  it("ignores a UDP port, which the forwarder could never use", () => {
    expect(soleTcpPort({ "5353/udp": null, "3000/tcp": null }, "portal")).toBe(3000);
  });

  it("refuses to guess between two TCP ports, naming the service and the candidates", () => {
    // The regression the old code would have shipped: key order is a string sort, so
    // a debugger on 9229 beside the app on 3000 was right only by luck, and a
    // hypothetical `10000/tcp` sorts BEFORE `3000/tcp` and would have won.
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
    // Which network to join is a decision about the stack's shape: the forwarder can
    // only reach an address on the network this container attaches to.
    expect(() => soleNetworkName({ a_net: {}, b_net: {} }, "portal")).toThrow(
      /portal is on more than one network \(a_net, b_net\)/,
    );
  });

  it("refuses a service on no network", () => {
    expect(() => soleNetworkName({}, "portal")).toThrow(/is on no network/);
  });
});

/**
 * The network join, which is the expensive one (issue #335).
 *
 * The old code wrapped `docker network connect` in `try {} catch {}` meaning "already
 * attached". It also meant network-not-found, no-such-container and daemon errors,
 * and the cost of that conflation was out of all proportion: the forwarder still
 * binds and still prints `ready`, so every forwarded connection then hits Docker's
 * cross-bridge isolation and TIMES OUT rather than being refused.
 *
 * So the outcome is now read back from Docker rather than inferred from an exit
 * status, and these cases are the whole decision: attached is fine however it got
 * that way, not attached is fatal however the connect reported.
 */
describe("joinComposeNetwork", () => {
  it("accepts a connect that failed because the endpoint was already there", () => {
    // The legitimate case the old catch was written for. An interrupted previous run
    // leaves this state behind, and attached is exactly as good as attaching.
    expect(() =>
      joinComposeNetwork("stack_default", "self", {
        connect: () => ({ failure: "endpoint with name self already exists in network" }),
        attached: () => ["stack_default"],
      }),
    ).not.toThrow();
  });

  it("throws naming the network when the connect really failed", () => {
    // What used to be swallowed. `docker network connect` reports one failure for
    // "already attached", "no such network" and "no such container" alike, so the
    // message is not what separates them: the read-back is.
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
    // The message is the fix: the old symptom was a Playwright timeout minutes later
    // that never mentioned the network, and a reader who lands on this line must not
    // have to rediscover why an unattached container times out instead of refusing.
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
