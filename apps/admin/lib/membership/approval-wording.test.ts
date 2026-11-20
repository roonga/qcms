import { describe, expect, it } from "vitest";

import {
  askedSentence,
  decidedSentence,
  expiryWording,
  heldRequests,
  newestOfKind,
  personLabel,
} from "./approval-wording.ts";
import type { ApprovalRequest } from "./types.ts";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "apr_1",
    kind: "second-approval-off",
    target: "ws_1",
    payload: {},
    requestedBy: "usr_1",
    requestedAt: "2026-11-20T12:00:00.000Z",
    expiresAt: "2026-11-27T12:00:00.000Z",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

describe("the held-request wording", () => {
  it("counts the days left on the window, and never counts below zero", () => {
    const [week, today, past] = heldRequests(
      [
        request(),
        request({ requestId: "apr_2", expiresAt: "2026-11-20T12:00:00.000Z" }),
        request({ requestId: "apr_3", expiresAt: "2026-11-01T12:00:00.000Z" }),
      ],
      NOW,
    );
    expect(week?.expiresInDays).toBe(7);
    expect(today?.expiresInDays).toBe(0);
    expect(past?.expiresInDays).toBe(0);
    expect(expiryWording(7)).toBe("Expires in 7 days.");
    expect(expiryWording(1)).toBe("Expires in 1 day.");
    expect(expiryWording(0)).toBe("Expires today.");
  });

  it("says what each kind asked for, and names a self-grant's group from its payload", () => {
    expect(askedSentence(request(), "grace@qcms.test")).toBe(
      "grace@qcms.test asked to turn Second approval off.",
    );
    expect(
      askedSentence(
        request({ kind: "self-grant", payload: { name: "Response viewers" } }),
        "luis@qcms.test",
      ),
    ).toBe("luis@qcms.test asked to give themselves access through Response viewers.");
    expect(askedSentence(request({ kind: "self-grant" }), "luis@qcms.test")).toContain(
      "an access group",
    );
    expect(askedSentence(request({ kind: "move-form" }), "priya@qcms.test")).toBe(
      "priya@qcms.test asked to move a form out of this workspace.",
    );
    expect(askedSentence(request({ kind: "draft-publish" }), "priya@qcms.test")).toContain(
      "does not name yet",
    );
  });

  it("reads a lapsed request as an ending rather than a rejection", () => {
    const lapsed = request({ status: "lapsed", decidedBy: "usr_2" });
    expect(decidedSentence(lapsed, "sam@qcms.test")).toContain("Ended undecided by sam@qcms.test");
    expect(decidedSentence(lapsed, "sam@qcms.test")).not.toContain("Rejected");
    expect(decidedSentence(request({ status: "rejected" }), "sam@qcms.test")).toBe(
      "Rejected by sam@qcms.test.",
    );
    expect(decidedSentence(request({ status: "expired" }), "")).toContain("can no longer");
    expect(decidedSentence(request(), "")).toBeUndefined();
  });

  it("names an account by the address this workspace knows, and by its id otherwise", () => {
    const people = new Map([["usr_1", "grace@qcms.test"]]);
    expect(personLabel("usr_1", people)).toBe("grace@qcms.test");
    expect(personLabel("usr_9", people)).toBe("usr_9 (account removed)");
    expect(personLabel(null, people)).toBe("");
  });

  it("speaks for the newest request of one kind only", () => {
    const held = heldRequests(
      [request({ requestId: "apr_new", kind: "self-grant" }), request({ requestId: "apr_old" })],
      NOW,
    );
    expect(newestOfKind(held, "second-approval-off")?.request.requestId).toBe("apr_old");
    expect(newestOfKind(held, "move-form")).toBeUndefined();
  });
});
