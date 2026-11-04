import { describe, expect, it } from "vitest";

import { policyForRequest } from "../../membership/route-policy.js";
import { SCREEN_IDS } from "../screens.js";
import { createForm } from "./forms-library.js";
import type { ActionRequestFacts } from "./types.js";

const ROUTE = { method: "POST", path: "/admin/forms" } as const;

function facts(body: unknown): ActionRequestFacts {
  return { path: ROUTE.path, method: ROUTE.method, params: {}, body, environment: "test" };
}

describe("form.create", () => {
  it("names the route the policy table authorises, with the same cell", () => {
    const policy = policyForRequest(ROUTE.method, ROUTE.path);
    expect(policy?.path).toBe(ROUTE.path);
    expect({ resource: policy?.resource, action: policy?.action }).toEqual(createForm.cell);
    expect(policy?.workspace).toBe("body");
  });

  it("acts in no environment of its own, so the switcher's is what a step binds", () => {
    expect(createForm.environmentFrom).toBe("switcher");
    expect(createForm.environmentArgument).toBeUndefined();
    expect(policyForRequest(ROUTE.method, ROUTE.path)?.environmentFrom).toBeUndefined();
  });

  it("recomputes the slug and the locale from the body, and the optional workspace with it", () => {
    expect(
      createForm.recomputeArgs(facts({ formId: "frm_x", slug: "x", defaultLocale: "en" })),
    ).toEqual({ slug: "x", defaultLocale: "en" });
    expect(
      createForm.recomputeArgs(
        facts({ formId: "frm_x", slug: "x", defaultLocale: "en", workspaceId: "wsp_a" }),
      ),
    ).toEqual({ slug: "x", defaultLocale: "en", workspaceId: "wsp_a" });
  });

  it("names no form id of its own, because the admin derives it from the slug it binds", () => {
    const members = Object.keys(
      (createForm.args as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(members).not.toContain("formId");
    expect(members).not.toContain("title");
  });

  it("refuses an argument set with an unknown member or a missing locale", () => {
    expect(createForm.args.safeParse({ slug: "x" }).success).toBe(false);
    expect(createForm.args.safeParse({ slug: "x", defaultLocale: "en", title: "X" }).success).toBe(
      false,
    );
    expect(createForm.args.safeParse({ slug: "x", defaultLocale: "en" }).success).toBe(true);
  });

  it("returns the new id as its one referenceable, allowlisted result", () => {
    expect(createForm.references).toEqual(["formId"]);
    expect(createForm.resultAllowlist).toContain("formId");
  });

  it("links the new form at a page route, which is where the card may link at all", () => {
    const link = createForm.card.createdLink;
    expect(link).toEqual({ screen: "/forms/[formId]", field: "formId" });
    expect(SCREEN_IDS).toContain(link?.screen);
    expect(createForm.references).toContain(link?.field);
  });

  it("mirrors the library's own creating control", () => {
    expect(createForm.screen).toBe("/forms");
    expect(createForm.card.headingControl).toBe("forms.create");
  });
});
