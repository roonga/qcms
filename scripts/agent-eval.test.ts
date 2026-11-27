import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  KEY_MISSING_MESSAGE,
  KEY_VARIABLE,
  PROJECT,
  hasKey,
  main,
  parseArgs,
  runEnv,
  runId,
  vitestArgs,
} from "./agent-eval.mjs";

const KEY = "synthetic-eval-key-6f21";

const NOW = new Date("2026-07-20T05:45:01.000Z");

function scratchRoot(): string {
  return mkdtempSync(join(tmpdir(), "qcms-agent-eval-"));
}

function withKey(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    [KEY_VARIABLE]: KEY,
    QCMS_AGENT_LANE: "agent-eval-test",
    QCMS_AGENT_SCRATCH_ROOT: scratchRoot(),
    ...extra,
  };
}

describe("the filters the command line takes", () => {
  it("reads the scenarios, the safety filter and the repetitions", () => {
    expect(parseArgs(["--scenario", "B09,B11", "--safety-only", "--reps", "1"])).toEqual({
      scenarios: "B09,B11",
      safetyOnly: true,
      reps: 1,
    });
  });

  it("defaults to every scenario at the configured repetitions", () => {
    expect(parseArgs([])).toEqual({ safetyOnly: false });
  });

  it("refuses an option it does not know or a value it cannot use", () => {
    expect(() => parseArgs(["--all"])).toThrow("unknown option");
    expect(() => parseArgs(["--scenario"])).toThrow("--scenario");
    expect(() => parseArgs(["--reps", "0"])).toThrow("--reps");
  });
});

describe("the key gate", () => {
  it("sees a key only when one is set and not blank", () => {
    expect(hasKey({ [KEY_VARIABLE]: KEY })).toBe(true);
    expect(hasKey({ [KEY_VARIABLE]: "  " })).toBe(false);
    expect(hasKey({})).toBe(false);
  });

  it("stops with exit 2 before anything is spawned", () => {
    let spawned = 0;
    const code = main([], {
      directory: process.cwd(),
      environment: { QCMS_AGENT_LANE: "agent-eval-test" },
      now: NOW,
      spawn: () => {
        spawned += 1;
        return { status: 0 };
      },
    });

    expect(code).toBe(2);
    expect(spawned).toBe(0);
    expect(KEY_MISSING_MESSAGE).toBe("Set QCMS_AGENT_API_KEY to run the agent eval");
  });

  it("stops with exit 2 on an option it cannot read", () => {
    expect(
      main(["--reps", "nine"], {
        directory: process.cwd(),
        environment: withKey(),
        now: NOW,
        spawn: () => ({ status: 0 }),
      }),
    ).toBe(2);
  });
});

describe("the run the command line hands to Vitest", () => {
  it("names the eval project alone", () => {
    expect(vitestArgs()).toEqual(["exec", "vitest", "run", "--project", PROJECT]);
  });

  it("stamps the run from the clock", () => {
    expect(runId(NOW, "a1b2c3")).toBe("20260720T054501Z-a1b2c3");
  });

  it("passes the run's facts and filters through the environment", () => {
    const passed = runEnv(withKey(), {
      id: "20260720T054501Z-a1b2c3",
      directory: "/scratch/agent-eval-20260720T054501Z-a1b2c3",
      gitSha: "0".repeat(40),
      parsed: { scenarios: "B09", safetyOnly: true, reps: 2 },
    });

    expect(passed).toMatchObject({
      QCMS_EVAL_RUN_ID: "20260720T054501Z-a1b2c3",
      QCMS_EVAL_DIR: "/scratch/agent-eval-20260720T054501Z-a1b2c3",
      QCMS_EVAL_GIT_SHA: "0".repeat(40),
      QCMS_EVAL_SCENARIOS: "B09",
      QCMS_EVAL_SAFETY_ONLY: "1",
      QCMS_EVAL_REPS: "2",
    });
  });

  it("leaves out the filters nobody asked for", () => {
    const passed = runEnv(withKey(), {
      id: "r1",
      directory: "/scratch/r1",
      gitSha: "unknown",
      parsed: { safetyOnly: false },
    });

    expect(passed.QCMS_EVAL_SCENARIOS).toBeUndefined();
    expect(passed.QCMS_EVAL_SAFETY_ONLY).toBeUndefined();
    expect(passed.QCMS_EVAL_REPS).toBeUndefined();
  });

  it("spawns the run in this lane's own scratch directory", () => {
    const seen: { args: string[]; directory: string | undefined }[] = [];
    const code = main([], {
      directory: process.cwd(),
      environment: withKey(),
      now: NOW,
      spawn: (_command, args, options) => {
        const passed = options as { env?: NodeJS.ProcessEnv };
        seen.push({ args, directory: passed.env?.QCMS_EVAL_DIR });
        return { status: 0 };
      },
    });

    expect(code).toBe(0);
    expect(seen[0]?.args).toEqual(vitestArgs());
    expect(seen[0]?.directory).toContain("agent-eval-test");
    expect(seen[0]?.directory).toContain("agent-eval-20260720T054501Z-");
  });
});
