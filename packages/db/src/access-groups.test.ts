import { describe, expect, it } from "vitest";

import {
  ACCESS_ROLES,
  ENVIRONMENT_ROLES,
  RESPONSES_ROLES,
  accessGroupFullName,
  carriesResponsesRole,
  isAccessRole,
  isResponsesRole,
  needsEnvironments,
  normaliseEnvironmentSet,
  refuseAccessGroupName,
  refuseAccessGroupRoles,
  refuseEnvironmentSet,
} from "./access-groups.js";

/** `control.environments` order, deliberately not alphabetical. */
const LIVE = ["test", "prod", "dev"] as const;

describe("the five role names", () => {
  it("are five, and each is exactly two segments", () => {
    expect(ACCESS_ROLES).toHaveLength(5);
    for (const role of ACCESS_ROLES) expect(role.split(".")).toHaveLength(2);
  });

  it("holds no role the earlier model carried", () => {
    expect(ACCESS_ROLES as readonly string[]).not.toContain("forms.approver");
    expect(ACCESS_ROLES as readonly string[]).not.toContain("forms.owner");
  });

  it("names the three roles that apply only in the group's environments", () => {
    expect([...ENVIRONMENT_ROLES]).toEqual([
      "forms.publisher",
      "responses.viewer",
      "responses.eraser",
    ]);
    expect(needsEnvironments(["forms.viewer", "forms.editor"])).toBe(false);
    expect(needsEnvironments(["forms.editor", "forms.publisher"])).toBe(true);
  });

  it("names the two data-family roles the self-grant rule reaches", () => {
    expect([...RESPONSES_ROLES]).toEqual(["responses.viewer", "responses.eraser"]);
    expect(isResponsesRole("forms.editor")).toBe(false);
    expect(isResponsesRole("responses.eraser")).toBe(true);
    expect(carriesResponsesRole(["forms.editor", "responses.viewer"])).toBe(true);
    expect(carriesResponsesRole(["forms.editor", "forms.publisher"])).toBe(false);
  });

  it("refuses a role outside the five", () => {
    expect(isAccessRole("forms.editor")).toBe(true);
    expect(isAccessRole("forms.approver")).toBe(false);
    expect(isAccessRole("admin")).toBe(false);
  });
});

describe("the role set a group carries", () => {
  it("accepts several roles", () => {
    expect(
      refuseAccessGroupRoles(["forms.editor", "forms.publisher", "responses.viewer"]),
    ).toBeUndefined();
  });

  it("refuses an empty set", () => {
    expect(refuseAccessGroupRoles([])).toContain("at least one role");
  });

  it("refuses an unknown role, which is the fail-closed direction", () => {
    expect(refuseAccessGroupRoles(["forms.approver"])).toContain("no such role: forms.approver");
  });

  it("refuses the same role twice", () => {
    expect(refuseAccessGroupRoles(["forms.editor", "forms.editor"])).toContain("twice");
  });
});

describe("the environment set", () => {
  it("requires at least one environment for a role that applies in one", () => {
    expect(refuseEnvironmentSet([], ["forms.publisher"], LIVE)).toContain("at least one");
    expect(refuseEnvironmentSet([], ["responses.viewer"], LIVE)).toContain("at least one");
    expect(refuseEnvironmentSet([], ["responses.eraser"], LIVE)).toContain("at least one");
  });

  it("requires none for a group carrying only View forms or Edit forms", () => {
    expect(refuseEnvironmentSet([], ["forms.viewer", "forms.editor"], LIVE)).toBeUndefined();
    expect(refuseEnvironmentSet(["prod"], ["forms.editor"], LIVE)).toContain("names no environment");
  });

  it("refuses an environment that does not exist", () => {
    expect(refuseEnvironmentSet(["staging"], ["forms.publisher"], LIVE)).toContain(
      "no such environment: staging",
    );
  });

  it("refuses the same environment twice", () => {
    expect(refuseEnvironmentSet(["prod", "prod"], ["forms.publisher"], LIVE)).toContain("twice");
  });

  it("has no value meaning every environment", () => {
    expect(refuseEnvironmentSet(["all"], ["forms.publisher"], LIVE)).toContain("no such environment");
  });

  it("stores a set in the environments table's order, whichever order it arrived in", () => {
    expect([...normaliseEnvironmentSet(["dev", "test"], LIVE)]).toEqual(["test", "dev"]);
    expect([...normaliseEnvironmentSet([], LIVE)]).toEqual([]);
  });
});

describe("the group name is a label", () => {
  it("accepts an administrator's own words", () => {
    expect(refuseAccessGroupName("Response viewers")).toBeUndefined();
  });

  it("refuses an empty name and a padded one", () => {
    expect(refuseAccessGroupName("")).toContain("cannot be empty");
    expect(refuseAccessGroupName(" Authors ")).toContain("leading or trailing space");
  });

  it("refuses a name longer than a list can show", () => {
    expect(refuseAccessGroupName("x".repeat(200))).toContain("at most");
  });
});

describe("the full name is derived and never stored", () => {
  it.each([
    ["home", "Response viewers", "home.Response viewers"],
    ["hr", "Authors", "hr.Authors"],
  ])("derives %s + %s as %s", (slug, stored, full) => {
    expect(accessGroupFullName(slug, stored)).toBe(full);
  });

  it("means a slug rename changes display only", () => {
    expect(accessGroupFullName("hr", "Publishers")).toBe("hr.Publishers");
    expect(accessGroupFullName("people", "Publishers")).toBe("people.Publishers");
  });
});
