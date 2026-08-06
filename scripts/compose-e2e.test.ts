import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

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
 * of the three script modules, with `.git` written as a FILE (a linked worktree) or
 * as a DIRECTORY (a primary checkout, and what CI checks out).
 *
 * Both cases are driven with an argv the script rejects anyway, so neither can reach
 * Docker even if the refusal were missing: a missing seat must produce the seat
 * error, and a present `.git` directory must produce the ordinary usage error.
 */

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const MODULES = ["compose-e2e.mjs", "ports.mjs", "docker-host.mjs"];
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repo root carrying the real scripts and the requested `.git` shape. */
function checkout(kind: "worktree" | "primary"): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-compose-e2e-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  for (const module of MODULES) copyFileSync(join(SCRIPTS, module), join(root, "scripts", module));
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
    // or the fix offered does not match the failure in front of the reader.
    const { stderr } = runWithoutSeat(checkout("worktree"), []);
    expect(stderr).toContain("pnpm up:e2e");
    expect(stderr).not.toContain("verify:browser");
  });

  it("refuses before it dispatches the subcommand, so nothing is ever spawned", () => {
    // `down` is the destructive one. It must not reach Docker on a seatless worktree
    // run, which this proves by getting the seat error instead of a Docker error.
    const { status, stderr } = runWithoutSeat(checkout("worktree"), ["down"]);
    expect(status).toBe(1);
    expect(stderr).toContain("QCMS_PORT_SEAT");
    expect(stderr).not.toContain("docker");
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
