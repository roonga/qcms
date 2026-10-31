import { describe, expect, it } from "vitest";

import { policyForRequest } from "../../membership/route-policy.js";
import { eraseResponse, unflagResponse } from "./responses.js";

/**
 * D4's two writes. The erasure's own card is the gate the screen's dialog is: it asks for
 * the session id, and the reason it records is the dialog's closed vocabulary rather than
 * anything a model wrote.
 */

describe("D4's action kinds", () => {
  it("names a route the policy table authorises, with the same cell", () => {
    for (const def of [eraseResponse, unflagResponse]) {
      const policy = policyForRequest(def.route.method, def.route.path);
      expect(policy?.path, def.kind).toBe(def.route.path);
      expect({ resource: policy?.resource, action: policy?.action }, def.kind).toEqual(def.cell);
    }
  });

  it("asks the erasure card for the session id, and the unflag card for nothing", () => {
    expect(eraseResponse.card.typedConfirmation).toBe("sessionId");
    expect(unflagResponse.card.typedConfirmation).toBeUndefined();
  });

  it("takes the reason from the dialog's own vocabulary and refuses anything else", () => {
    const valid = { formId: "frm_a", sessionId: "ses_a", reason: "retention_policy" };
    expect(eraseResponse.args.safeParse(valid).success).toBe(true);
    expect(
      eraseResponse.args.safeParse({ ...valid, reason: "a name the model typed" }).success,
    ).toBe(false);
    expect(eraseResponse.args.safeParse({ formId: "frm_a", sessionId: "ses_a" }).success).toBe(
      false,
    );
  });

  it("recomputes both kinds' arguments from the route and the body", () => {
    expect(
      eraseResponse.recomputeArgs({
        path: eraseResponse.route.path,
        method: "POST",
        params: { id: "frm_a", sessionId: "ses_a" },
        body: { reason: "operator_error" },
        environment: "test",
      }),
    ).toEqual({ formId: "frm_a", sessionId: "ses_a", reason: "operator_error" });

    expect(
      unflagResponse.recomputeArgs({
        path: unflagResponse.route.path,
        method: "POST",
        params: { id: "frm_a", sessionId: "ses_a" },
        body: undefined,
        environment: "test",
      }),
    ).toEqual({ formId: "frm_a", sessionId: "ses_a" });
  });

  it("allowlists no field that could carry an answer", () => {
    for (const def of [eraseResponse, unflagResponse]) {
      expect(def.resultAllowlist.includes("answers"), def.kind).toBe(false);
      expect(def.references, def.kind).toEqual([]);
    }
  });
});
