import { describe, expect, it } from "vitest";

import type { QuestionDefinitionView, QuestionStatus, QuestionVersion } from "./types.ts";
import { latestPublishedVersion, selectVersion, versionRailItems } from "./version-rail.ts";

/**
 * What the question rail carries, as a decision rather than as pixels (issue 650).
 *
 * `plan/admin-shell-poc/question-editor-poc.html` draws one group of version rows, newest
 * first, with the selected one marked and a digest above them saying how many there are and
 * which is published. Three of those four claims are answerable without a DOM, so they are
 * answered here and the markup is tested next door for being markup.
 *
 * `selectVersion` is the one function on this screen that two React trees both call: the page
 * renders the version it returns and the rail marks the row it names, from the same address.
 * Its behaviour moved here unchanged from the page in issue 650, so the cases below are also
 * the record that nothing about `?v=` changed when the rail arrived.
 */

const DEFINITION = { type: "shortText" } as unknown as QuestionDefinitionView;

function version(n: number, status: QuestionStatus, publishedAt: string | null): QuestionVersion {
  return {
    questionId: "q_smoking_status",
    version: n,
    status,
    definition: DEFINITION,
    publishedAt,
  };
}

/** Oldest first, as the API returns them: v1 deprecated, v2 and v3 published, v4 a draft. */
const VERSIONS: readonly QuestionVersion[] = [
  version(1, "deprecated", "2025-06-20T09:00:00.000Z"),
  version(2, "published", "2025-11-02T09:00:00.000Z"),
  version(3, "published", "2026-05-14T09:00:00.000Z"),
  version(4, "draft", null),
];

describe("which version the address selects", () => {
  it("takes the one named by ?v", () => {
    expect(selectVersion(VERSIONS, "2")?.version).toBe(2);
  });

  it("falls back to the newest when there is no ?v at all", () => {
    expect(selectVersion(VERSIONS, undefined)?.version).toBe(4);
  });

  it("falls back to the newest rather than 404ing on a ?v naming no version", () => {
    expect(selectVersion(VERSIONS, "99")?.version).toBe(4);
    expect(selectVersion(VERSIONS, "not-a-number")?.version).toBe(4);
  });

  it("takes the first when a hand-built address repeats ?v", () => {
    expect(selectVersion(VERSIONS, ["3", "1"])?.version).toBe(3);
  });

  it("has no answer for a question with no versions, which is the screen's 404", () => {
    expect(selectVersion([], "1")).toBeUndefined();
  });
});

describe("the version rows", () => {
  it("are newest first, which is the order the POC draws", () => {
    expect(versionRailItems("q_smoking_status", VERSIONS, 4).map((item) => item.version)).toEqual([
      4, 3, 2, 1,
    ]);
  });

  it("point at ?v on this same route, because a version is not a route here", () => {
    expect(versionRailItems("q_smoking_status", VERSIONS, 4)[0]?.href).toBe(
      "/questions/q_smoking_status?v=4",
    );
  });

  it("escape a question id before putting it in an address", () => {
    expect(versionRailItems("q_a b", VERSIONS, 1)[0]?.href).toBe("/questions/q_a%20b?v=4");
  });

  it("mark exactly one row current, and it is the selected one", () => {
    const current = versionRailItems("q_smoking_status", VERSIONS, 2).filter(
      (item) => item.isCurrent,
    );
    expect(current.map((item) => item.version)).toEqual([2]);
  });

  it("carry each version's own status, not the question's latest", () => {
    expect(versionRailItems("q_smoking_status", VERSIONS, 4).map((item) => item.status)).toEqual([
      "draft",
      "published",
      "published",
      "deprecated",
    ]);
  });
});

describe("the digest's published version", () => {
  it("is the newest published one", () => {
    expect(latestPublishedVersion(VERSIONS)).toBe(3);
  });

  it("is null when nothing has ever been published", () => {
    expect(latestPublishedVersion([version(1, "draft", null)])).toBeNull();
  });

  // A deprecated version blocks new pins, so naming one as the published version would tell
  // an operator something is current that is not.
  it("ignores a deprecated version, however recent", () => {
    expect(
      latestPublishedVersion([
        version(1, "published", "2025-01-01T00:00:00.000Z"),
        version(2, "deprecated", "2026-01-01T00:00:00.000Z"),
      ]),
    ).toBe(1);
  });
});
