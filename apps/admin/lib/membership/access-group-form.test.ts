import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_ROLES,
  GROUP_ROLES,
  grantCandidates,
  groupScope,
  groupTitlesByName,
  needsEnvironments,
  orderedEnvironments,
  roleDescription,
  roleName,
  setOf,
  toggleOne,
} from "./access-group-form.ts";

describe("role names", () => {
  it("gives every group role and the administrator a plain name and a one-line description", () => {
    expect(GROUP_ROLES.map(roleName)).toEqual([
      "Form viewer",
      "Form editor",
      "Form publisher",
      "Response viewer",
      "Response eraser",
    ]);
    expect(roleName("forms.owner")).toBe("Workspace owner");
    for (const role of [...GROUP_ROLES, "forms.owner"]) {
      expect(roleDescription(role), role).toMatch(/\.$/u);
      expect(roleDescription(role), role).not.toContain(role);
    }
  });

  it("carries no approver role and keeps the administrator off the group list", () => {
    expect(GROUP_ROLES).not.toContain("forms.approver");
    expect(GROUP_ROLES).not.toContain("forms.owner");
  });

  it("shows an unfamiliar wire role as it arrived rather than hiding it", () => {
    expect(roleName("forms.future")).toBe("forms.future");
    expect(roleDescription("forms.future")).toBeUndefined();
  });
});

describe("which roles name environments", () => {
  it("asks for none while the group only reads or edits forms", () => {
    expect(needsEnvironments([])).toBe(false);
    expect(needsEnvironments(["forms.viewer"])).toBe(false);
    expect(needsEnvironments(["forms.viewer", "forms.editor"])).toBe(false);
  });

  it("asks for one as soon as any environment role is carried", () => {
    for (const role of ENVIRONMENT_ROLES) {
      expect(needsEnvironments([role]), role).toBe(true);
    }
    expect(needsEnvironments(["forms.editor", "responses.eraser"])).toBe(true);
  });

  it("asks for none for a role the screen does not know", () => {
    expect(needsEnvironments(["forms.future"])).toBe(false);
  });
});

describe("ticking a box", () => {
  it("adds a pick, drops it again, and leaves the others alone", () => {
    const one = toggleOne([], "prod", true);
    expect(one).toEqual(["prod"]);
    const two = toggleOne(one, "dev", true);
    expect(two).toEqual(["prod", "dev"]);
    expect(toggleOne(two, "prod", false)).toEqual(["dev"]);
  });

  it("keeps one entry per value however often it is ticked on", () => {
    expect(toggleOne(toggleOne(["dev"], "dev", true), "dev", true)).toEqual(["dev"]);
  });

  it("unticking something never picked changes nothing", () => {
    expect(toggleOne(["dev"], "prod", false)).toEqual(["dev"]);
  });
});

describe("the wire set", () => {
  it("sends picks in the installation's order whatever order they were ticked in", () => {
    let chosen = toggleOne([], "prod", true);
    chosen = toggleOne(chosen, "dev", true);
    expect(setOf(chosen, ["dev", "test", "prod"])).toEqual(["dev", "prod"]);
  });

  it("is empty when nothing is ticked, and drops a value the installation does not have", () => {
    expect(setOf([], ["dev", "test"])).toEqual([]);
    expect(setOf(["dev", "gone"], ["dev", "test"])).toEqual(["dev"]);
  });

  it("orders environments by the installation's position, by name where they tie", () => {
    expect(
      orderedEnvironments([
        { name: "prod", position: 3 },
        { name: "dev", position: 1 },
        { name: "test", position: 2 },
      ]),
    ).toEqual(["dev", "test", "prod"]);
    expect(
      orderedEnvironments([
        { name: "staging", position: 1 },
        { name: "dev", position: 1 },
      ]),
    ).toEqual(["dev", "staging"]);
  });
});

describe("a group in words", () => {
  it("reads as its roles and the environments it names", () => {
    expect(groupScope({ roles: ["responses.viewer"], environments: ["test"] })).toBe(
      "Response viewer, in test",
    );
    expect(
      groupScope({
        roles: ["forms.publisher", "responses.eraser"],
        environments: ["test", "prod"],
      }),
    ).toBe("Form publisher, Response eraser, in test, prod");
  });

  it("names every environment when the group's roles ignore the set", () => {
    expect(groupScope({ roles: ["forms.editor"], environments: [] })).toBe(
      "Form editor, in every environment",
    );
  });

  it("reads a member row's group name back as that group's scope", () => {
    const titles = groupTitlesByName([
      { name: "Authors", roles: ["forms.editor"], environments: [] },
      { name: "Publishers", roles: ["forms.publisher"], environments: ["prod"] },
    ]);
    expect(titles.get("Authors")).toBe("Form editor, in every environment");
    expect(titles.get("Publishers")).toBe("Form publisher, in prod");
    expect(titles.get("Gone")).toBeUndefined();
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
