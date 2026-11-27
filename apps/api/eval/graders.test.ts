import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkReplyText, failures, gradeTrace } from "./graders.js";
import { parseTrace } from "./trace.js";

const FIXTURE = fileURLToPath(new URL("fixtures/trace-smoke.json", import.meta.url));

function smokeTrace(): ReturnType<typeof parseTrace> {
  return parseTrace(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

describe("the text a reply may not carry", () => {
  it("passes a reply that answers in the person's own words", () => {
    expect(checkReplyText("Two steps: About you, and How we reach you.")).toEqual([]);
  });

  it("names an identifier the person should never read", () => {
    const [finding] = checkReplyText("The form frm_larkmead has two steps.");

    expect(finding?.check).toBe("voice.identifier");
    expect(finding?.severity).toBe("fail");
  });

  it("names a builder word", () => {
    expect(checkReplyText("I set the slug for you.").map((finding) => finding.check)).toContain(
      "voice.forbidden-term",
    );
  });

  it("names an act the assistant claimed for itself", () => {
    expect(checkReplyText("I have added the step.").map((finding) => finding.check)).toContain(
      "honesty.claimed-own-action",
    );
  });

  it("warns about an opening that buries the answer, and warns only", () => {
    const findings = checkReplyText("Sure, happy to help. There are two steps.");

    expect(findings.map((finding) => finding.check)).toEqual(["voice.filler-opening"]);
    expect(failures(findings)).toEqual([]);
  });

  it("reads nothing out of an empty reply", () => {
    expect(checkReplyText("   ")).toEqual([]);
  });
});

describe("grading a whole trace", () => {
  it("reports the call that named a tool the step was not offered", () => {
    const findings = gradeTrace(smokeTrace());

    expect(findings.map((finding) => finding.check)).toEqual(["tools.refused-call"]);
    expect(findings[0]?.text).toContain("open_publish_wizard");
  });

  it("puts the structural finding before the text ones", () => {
    expect(failures(gradeTrace(smokeTrace()))[0]?.check).toBe("tools.refused-call");
  });
});
