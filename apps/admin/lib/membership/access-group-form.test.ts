import { describe, expect, it } from "vitest";

import {
  ALL,
  formOptions,
  GROUP_ROLES,
  grantCandidates,
  groupNameFor,
  isChosen,
  orderedEnvironments,
  roleDescription,
  roleName,
  scopeLabel,
  scopeOf,
  toggleAll,
  toggleOne,
} from "./access-group-form.ts";

describe("role names", () => {
  it("gives every group role and the owner a plain name and a one-line description", () => {
    expect(GROUP_ROLES.map(roleName)).toEqual([
      "Form viewer",
      "Form editor",
      "Release approver",
      "Response viewer",
      "Response eraser",
    ]);
    expect(roleName("forms.owner")).toBe("Workspace owner");
    for (const role of [...GROUP_ROLES, "forms.owner"]) {
      expect(roleDescription(role), role).toMatch(/\.$/u);
      expect(roleDescription(role), role).not.toContain(role);
    }
  });

  it("shows an unfamiliar wire role as it arrived rather than hiding it", () => {
    expect(roleName("forms.future")).toBe("forms.future");
    expect(roleDescription("forms.future")).toBeUndefined();
  });
});

describe("a scope choice", () => {
  it("starts at all and sends the wire's own word for it", () => {
    expect(scopeOf(ALL, ["dev", "test"])).toEqual(["all"]);
  });

  it("clears to nothing chosen when all is unticked, which sends nothing", () => {
    const none = toggleAll(ALL, false);
    expect(scopeOf(none, ["dev", "test"])).toEqual([]);
  });

  it("sends picks in the given order whatever order they were ticked in", () => {
    let choice = toggleOne(ALL, "prod", true);
    choice = toggleOne(choice, "dev", true);
    expect(scopeOf(choice, ["dev", "test", "prod"])).toEqual(["dev", "prod"]);
    expect(isChosen(choice, "prod")).toBe(true);
    choice = toggleOne(choice, "prod", false);
    expect(scopeOf(choice, ["dev", "test", "prod"])).toEqual(["dev"]);
  });

  it("returns to all when all is ticked again, dropping the picks", () => {
    const some = toggleOne(ALL, "dev", true);
    expect(toggleAll(some, true)).toEqual(ALL);
    expect(toggleAll(some, false)).toBe(some);
  });
});

describe("the group's name", () => {
  it("is spelled the way the API checks it, label optional", () => {
    expect(groupNameFor("responses.viewer", ["all"], "")).toBe("all.responses.viewer");
    expect(groupNameFor("forms.editor", ["dev", "test"], " claims ")).toBe(
      "dev-test.forms.editor.claims",
    );
  });

  it("is absent until an environment is chosen", () => {
    expect(groupNameFor("forms.viewer", [], "x")).toBeUndefined();
  });

  it("orders environments by the installation's position", () => {
    expect(
      orderedEnvironments([
        { name: "prod", position: 3 },
        { name: "dev", position: 1 },
        { name: "test", position: 2 },
      ]),
    ).toEqual(["dev", "test", "prod"]);
  });
});

describe("the forms picker", () => {
  const forms = [
    { formId: "frm_a", name: "claims" },
    { formId: "frm_b", name: "vehicle-check" },
    { formId: "frm_c", name: "signup" },
  ];

  it("searches by name, case-insensitively, and never by pasted id", () => {
    expect(formOptions(forms, "VEHICLE", ALL).map((form) => form.formId)).toEqual(["frm_b"]);
    expect(formOptions(forms, "frm_a", ALL)).toEqual([]);
    expect(formOptions(forms, "  ", ALL)).toHaveLength(3);
  });

  it("keeps a chosen form in the list while the search hides its neighbours", () => {
    const choice = toggleOne(ALL, "frm_c", true);
    expect(formOptions(forms, "claims", choice).map((form) => form.formId)).toEqual([
      "frm_a",
      "frm_c",
    ]);
  });

  it("reads a stored scope back by name where known, and all as the catalog word", () => {
    const names = new Map(forms.map((form) => [form.formId, form.name]));
    expect(scopeLabel(["all"], "membership.groups.scopeAll")).toBe("All");
    expect(
      scopeLabel(["frm_a", "frm_x"], "membership.groups.scopeAll", (id) => names.get(id) ?? id),
    ).toBe("claims, frm_x");
  });
});

describe("who a grant can name", () => {
  it("offers only members, and only those not already holding the group", () => {
    const members = [
      { userId: "u1", email: "a@qcms.test", name: "A" },
      { userId: "u2", email: "b@qcms.test", name: "B" },
    ];
    expect(grantCandidates(members, [{ userId: "u1" }]).map((m) => m.userId)).toEqual(["u2"]);
    expect(grantCandidates(members, [{ userId: "u1" }, { userId: "u2" }])).toEqual([]);
  });
});
