import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnvironmentSummary } from "./release-tables.tsx";
import type { ReleaseRecord } from "../../lib/forms/releases.ts";

function release(environment: string, closed: boolean): ReleaseRecord {
  return {
    formId: "frm_alpha",
    environment,
    version: 2,
    sequence: 1,
    fromEnvironment: null,
    releasedBy: "usr_alice",
    releasedAt: "2026-11-08T00:00:00.000Z",
    approvedBy: null,
    replacedVersion: null,
    rollback: false,
    closed,
  };
}

describe("what each environment is serving", () => {
  it("reads all three availabilities, including the environment with no release", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSummary
        releases={[release("test", false), release("stage", true)]}
        environments={["test", "stage", "prod"]}
      />,
    );

    expect(markup).toContain('data-availability="open"');
    expect(markup).toContain('data-availability="closed"');
    expect(markup).toContain('data-availability="unreleased"');
    // The cell was blank for an environment with no release, which read as a missing value.
    expect(markup).toContain(">Not Released<");
  });
});
