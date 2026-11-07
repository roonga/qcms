import { describe, expect, it } from "vitest";

import { policyForRequest } from "../../membership/route-policy.js";
import { closeForm, reopenForm, updateFormSettings } from "./forms.js";
import type { ActionKindDef, ActionRequestFacts, ActionRoute } from "./types.js";

/**
 * D1's three kinds. What matters per kind is that the arguments the card displays are the
 * arguments recomputed from the request, and that the route the descriptor names is the one
 * the policy table authorises, so neither half can drift from the other.
 */

const SETTINGS_FACTS: ActionRequestFacts = {
  path: "/admin/forms/{id}/settings",
  method: "PATCH",
  params: { id: "frm_a" },
  body: { challengeRequired: true, minSubmitMs: 1500 },
  environment: "test",
};

function factsFor(def: ActionKindDef, body: unknown): ActionRequestFacts {
  return {
    path: routeOf(def).path,
    method: routeOf(def).method,
    params: { id: "frm_a" },
    body,
    environment: "test",
  };
}

/** A routed kind's own route. Only a hand-off declares none, and none of these is one. */
function routeOf(def: ActionKindDef): ActionRoute {
  const route = def.route;
  if (route === undefined) throw new Error(`${def.kind} declares no route`);
  return route;
}

describe("D1's action kinds", () => {
  it("names a route the policy table authorises, with the same cell", () => {
    for (const def of [updateFormSettings, closeForm, reopenForm]) {
      const policy = policyForRequest(routeOf(def).method, routeOf(def).path);
      expect(policy?.path, def.kind).toBe(routeOf(def).path);
      expect({ resource: policy?.resource, action: policy?.action }, def.kind).toEqual(def.cell);
    }
  });

  it("takes the environment from the switcher, so a step confirmed elsewhere is refused", () => {
    for (const def of [updateFormSettings, closeForm, reopenForm]) {
      expect(def.environmentFrom, def.kind).toBe("switcher");
      expect(def.environmentArgument, def.kind).toBeUndefined();
    }
  });

  it("recomputes a settings patch as the card displays it, omitting what the patch left alone", () => {
    expect(updateFormSettings.recomputeArgs(SETTINGS_FACTS)).toEqual({
      formId: "frm_a",
      challengeRequired: true,
      minSubmitMs: 1500,
    });
    expect(
      updateFormSettings.recomputeArgs({ ...SETTINGS_FACTS, body: { minSubmitMs: null } }),
    ).toEqual({ formId: "frm_a", minSubmitMs: null });
  });

  it("accepts a patch that names one setting and refuses an unknown member", () => {
    expect(updateFormSettings.args.safeParse({ formId: "frm_a", minSubmitMs: null }).success).toBe(
      true,
    );
    expect(
      updateFormSettings.args.safeParse({ formId: "frm_a", challengeRequired: "yes" }).success,
    ).toBe(false);
    expect(updateFormSettings.args.safeParse({ formId: "frm_a", other: 1 }).success).toBe(false);
  });

  it("recomputes the availability kinds from the route alone, so the body's environment is checked apart", () => {
    for (const def of [closeForm, reopenForm]) {
      expect(def.recomputeArgs(factsFor(def, { environment: "prod" })), def.kind).toEqual({
        formId: "frm_a",
      });
      expect(def.args.safeParse({ formId: "frm_a" }).success, def.kind).toBe(true);
      expect(def.args.safeParse({ formId: "frm_a", environment: "prod" }).success, def.kind).toBe(
        false,
      );
    }
  });

  it("keeps close and reopen on their own routes", () => {
    expect(routeOf(closeForm).path).toBe("/admin/forms/{id}/close");
    expect(routeOf(reopenForm).path).toBe("/admin/forms/{id}/reopen");
  });
});
