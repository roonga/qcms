import { describe, expect, it } from "vitest";

import { publishChangesFor } from "./publish-changes";

const READ = {
  ok: true as const,
  data: { base: null, draft: null, agentAssisted: false, changes: [] },
};

describe("publishChangesFor", () => {
  it("says the read failed wherever the wizard was entered from", () => {
    expect(publishChangesFor({ ok: false }, false)).toEqual({ status: "unread" });
    expect(publishChangesFor({ ok: false }, true)).toEqual({ status: "unread" });
  });

  it("shows nothing outside the builder path when the assistant changed nothing", () => {
    expect(publishChangesFor(READ, false)).toBeUndefined();
  });

  it("shows the read from the builder, or when the rows say the assistant changed the draft", () => {
    expect(publishChangesFor(READ, true)).toMatchObject({ status: "read", steps: [] });
    const assisted = {
      ok: true as const,
      data: {
        ...READ.data,
        agentAssisted: true,
        changes: [{ kind: "apply-draft", revision: 2, confirmedAt: "2026-11-18T00:00:00.000Z" }],
      },
    };
    expect(publishChangesFor(assisted, false)).toMatchObject({
      status: "read",
      steps: [{ kind: "apply-draft", revision: 2 }],
    });
  });
});
