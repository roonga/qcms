import { describe, expect, it } from "vitest";

import {
  expirySentence,
  heldDecisionRefusal,
  heldPublishViews,
  parseHeldPublishes,
  type HeldPublishRequest,
} from "./held-publish.ts";

const NOW = Date.parse("2026-11-08T10:02:00.000Z");
const DAY = 86_400_000;

function request(overrides: Partial<HeldPublishRequest> = {}): HeldPublishRequest {
  return {
    requestId: "apr_1",
    requestedBy: "usr_grace",
    requestedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 7 * DAY).toISOString(),
    status: "pending",
    draftUnchanged: true,
    requestedByName: "Grace Mensah",
    decidedByName: null,
    ...overrides,
  };
}

describe("heldPublishViews", () => {
  it("shows the requester the request pending with no decision", () => {
    const [view] = heldPublishViews([request()], {
      viewerId: "usr_grace",
      canApprove: true,
      now: NOW,
    });
    expect(view).toMatchObject({ own: true, decides: false, block: undefined, expiresInDays: 7 });
  });

  it("gives the decision to another holder of Publish forms in prod", () => {
    const [view] = heldPublishViews([request()], {
      viewerId: "usr_luis",
      canApprove: true,
      now: NOW,
    });
    expect(view).toMatchObject({ own: false, decides: true });
  });

  it("gives no decision to a viewer without Publish forms in prod", () => {
    const [view] = heldPublishViews([request()], {
      viewerId: "usr_luis",
      canApprove: false,
      now: NOW,
    });
    expect(view?.decides).toBe(false);
  });

  it("blocks a changed draft and an expired request before Approve is pressed", () => {
    const views = heldPublishViews(
      [
        request({ requestId: "apr_changed", draftUnchanged: false }),
        request({ requestId: "apr_old", expiresAt: new Date(NOW - 1).toISOString() }),
      ],
      { viewerId: "usr_luis", canApprove: true, now: NOW },
    );
    expect(views.map((view) => view.block)).toEqual(["changed", "expired"]);
  });

  it("leaves decided requests out", () => {
    expect(
      heldPublishViews([request({ status: "lapsed" }), request({ status: "approved" })], {
        viewerId: "usr_luis",
        canApprove: true,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("parseHeldPublishes", () => {
  it("drops a row it cannot read", () => {
    expect(
      parseHeldPublishes({ requests: [{ requestId: 1 }, { ...request(), status: "odd" }] }),
    ).toEqual([]);
    expect(parseHeldPublishes({ requests: [request()] })).toEqual([request()]);
    expect(
      parseHeldPublishes({ requests: [{ ...request(), requestedByName: "  ", decidedByName: 3 }] }),
    ).toEqual([request({ requestedByName: null })]);
  });
});

describe("copy", () => {
  it("counts the days left", () => {
    expect(expirySentence(7)).toBe("Expires in 7 days.");
    expect(expirySentence(1)).toBe("Expires in 1 day.");
    expect(expirySentence(0)).toBe("Expires today.");
  });

  it("words each refusal", () => {
    expect(heldDecisionRefusal("DRAFT_CHANGED_SINCE_REQUEST", "", "prod")).toBe(
      "This draft has changed since publishing was requested. Request publishing again.",
    );
    expect(heldDecisionRefusal("OWN_REQUEST", "", "prod")).toBe(
      "You asked for this, so another person with Publish forms in Production approves.",
    );
    expect(
      heldDecisionRefusal("REQUESTER_CANNOT_PUBLISH", "", "prod", {
        requester: "Grace Mensah",
        workspace: "Clinical",
      }),
    ).toBe(
      "Not applied: Grace Mensah no longer holds Edit forms and Publish forms for Production in Clinical.",
    );
    expect(heldDecisionRefusal("REQUESTER_CANNOT_PUBLISH", "", "prod")).toBe(
      "Not applied: the person who asked no longer holds Edit forms and Publish forms for Production in this workspace.",
    );
    expect(heldDecisionRefusal("REQUEST_EXPIRED", "", "prod")).toBe(
      "This request expired and can no longer be approved.",
    );
  });
});
