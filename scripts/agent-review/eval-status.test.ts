import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createStatus,
  main,
  MAX_TEXT,
  readStatus,
  STATUS_FILE_NAME,
  validateStatus,
  withScenario,
  writeStatus,
} from "./eval-status.mjs";

const RUN = {
  runId: "eval-2026-01-01",
  startedAt: "2026-01-01T09:00:00.000Z",
  stack: { adminUrl: "http://localhost:7340", headSha: "abcdef1", promptVersion: "2" },
  scenarios: [
    { id: "new-patient-form", title: "A new patient form", budget: 2 },
    { id: "publish-and-test-link", title: "Publish and a test link", budget: 3 },
  ],
};

const LATER = "2026-01-01T09:05:00.000Z";

const directories: string[] = [];

function scratch(): string {
  const made = mkdtempSync(join(tmpdir(), "qcms-eval-status-"));
  directories.push(made);
  return made;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("the review run's status file", () => {
  it("starts every scenario queued, with nothing checked or reviewed", () => {
    const status = createStatus(RUN);

    expect(status["updatedAt"]).toBe(RUN.startedAt);
    expect(validateStatus(status)).toEqual([]);
    expect(status["scenarios"]).toEqual([
      {
        id: "new-patient-form",
        title: "A new patient form",
        state: "queued",
        turns: 0,
        budget: 2,
        checks: { exit: null, findings: [] },
        review: { verdict: null, findings: [] },
        note: "",
      },
      expect.objectContaining({ id: "publish-and-test-link", state: "queued", budget: 3 }),
    ]);
  });

  it("stamps the update time and leaves the other scenarios alone", () => {
    const status = withScenario(createStatus(RUN), "new-patient-form", { state: "running" }, LATER);

    expect(status["updatedAt"]).toBe(LATER);
    const [first, second] = status["scenarios"] as Record<string, unknown>[];
    expect(first?.["state"]).toBe("running");
    expect(second?.["state"]).toBe("queued");
  });

  it("merges a patch into checks without dropping what it does not name", () => {
    const first = withScenario(
      createStatus(RUN),
      "new-patient-form",
      {
        state: "checked",
        turns: 2,
        checks: {
          exit: 1,
          findings: [
            { id: "budget", severity: "fail", text: "three turns against a budget of two" },
          ],
        },
      },
      LATER,
    );
    const second = withScenario(first, "new-patient-form", { checks: { exit: 1 } }, LATER);

    const scenario = (second["scenarios"] as Record<string, unknown>[])[0];
    const checks = scenario?.["checks"] as Record<string, unknown>;
    expect((checks["findings"] as unknown[]).length).toBe(1);
  });

  it("refuses a scenario it does not hold", () => {
    expect(() => withScenario(createStatus(RUN), "missing", { state: "run" }, LATER)).toThrow(
      /no scenario 'missing'/u,
    );
  });

  it("names every field that is wrong rather than the first", () => {
    const problems = validateStatus({
      runId: "",
      startedAt: "not a date",
      updatedAt: LATER,
      stack: {},
      scenarios: [
        {
          id: "a",
          title: "A",
          state: "finished",
          turns: -1,
          budget: 2,
          note: "",
          checks: { exit: 4, findings: [] },
          review: { verdict: "ok", findings: [] },
        },
      ],
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        "runId must be a non-empty string",
        "startedAt must be a timestamp",
        "stack.adminUrl must be a non-empty string",
        expect.stringContaining("scenarios[0].state must be one of"),
        "scenarios[0].turns must be a whole number of turns",
        "scenarios[0].checks.exit must be 0, 1, 2 or null",
        expect.stringContaining("scenarios[0].review.verdict must be one of"),
      ]),
    );
  });

  it("keeps a transcript and an address out of it", () => {
    const long = withScenario(
      createStatus(RUN),
      "new-patient-form",
      { note: "x".repeat(MAX_TEXT + 1) },
      LATER,
    );
    const addressed = withScenario(
      createStatus(RUN),
      "new-patient-form",
      {
        checks: {
          exit: 1,
          findings: [
            { id: "link", severity: "fail", text: "it showed http://localhost:7300/l/abc" },
          ],
        },
      },
      LATER,
    );

    expect(validateStatus(long)).toEqual([
      `scenarios[0].note is longer than ${String(MAX_TEXT)} characters`,
    ]);
    expect(validateStatus(addressed)).toEqual([
      "scenarios[0].checks.findings[0].text carries an address; this file holds none",
    ]);
  });

  it("writes through a rename and leaves no temporary behind", () => {
    const directory = scratch();
    const path = join(directory, STATUS_FILE_NAME);

    writeStatus(path, createStatus(RUN));

    expect(readdirSync(directory)).toEqual([STATUS_FILE_NAME]);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
    expect(readStatus(path)["runId"]).toBe(RUN.runId);
  });

  it("refuses to write a status that does not match the shape", () => {
    const path = join(scratch(), STATUS_FILE_NAME);

    expect(() => writeStatus(path, { runId: "r" })).toThrow(/the status file is wrong/u);
    expect(readdirSync(join(path, ".."))).toEqual([]);
  });

  it("drives the same three steps from the command line", () => {
    const path = join(scratch(), STATUS_FILE_NAME);

    expect(main(["init", path, JSON.stringify(RUN)], LATER)).toBe(0);
    expect(
      main(
        ["set", path, "publish-and-test-link", JSON.stringify({ state: "run", turns: 3 })],
        LATER,
      ),
    ).toBe(0);
    expect(main(["check", path], LATER)).toBe(0);
    expect(main(["set", path], LATER)).toBe(2);

    const scenario = (readStatus(path)["scenarios"] as Record<string, unknown>[])[1];
    expect(scenario?.["state"]).toBe("run");
    expect(scenario?.["turns"]).toBe(3);
  });

  it("takes the clock's time when the run does not name a start", () => {
    const path = join(scratch(), STATUS_FILE_NAME);
    const { stack, scenarios, runId } = RUN;

    main(["init", path, JSON.stringify({ runId, stack, scenarios })], LATER);

    expect(readStatus(path)["startedAt"]).toBe(LATER);
  });
});
