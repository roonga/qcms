import { describe, expect, it } from "vitest";

import {
  ACCESS_ROLES,
  RESPONSES_ROLES,
  TEAM_ROLES,
  accessGroupDirectoryName,
  accessGroupFullName,
  accessGroupNameFor,
  isAccessRole,
  isResponsesRole,
  isTeamRole,
  normaliseEnvironmentScope,
  parseAccessGroupName,
  refuseAccessGroupName,
  refuseEnvironmentScope,
} from "./access-groups.js";

/** `control.environments` order, deliberately not alphabetical. */
const LIVE = ["test", "prod", "dev"] as const;

describe("the six role names (Q38)", () => {
  it("are six, and each is exactly two segments", () => {
    expect(ACCESS_ROLES).toHaveLength(6);
    for (const role of ACCESS_ROLES) expect(role.split(".")).toHaveLength(2);
  });

  it("puts `forms.owner` outside the team roles, because it is the member row's (Q32)", () => {
    expect(TEAM_ROLES).toHaveLength(5);
    expect(TEAM_ROLES).not.toContain("forms.owner");
    expect(isTeamRole("forms.owner")).toBe(false);
    expect(isTeamRole("responses.viewer")).toBe(true);
  });

  it("names the two data-family roles the self-grant rule reaches (Q56)", () => {
    expect([...RESPONSES_ROLES]).toEqual(["responses.viewer", "responses.eraser"]);
    expect(isResponsesRole("forms.editor")).toBe(false);
    expect(isResponsesRole("responses.eraser")).toBe(true);
  });

  it("refuses a role outside the six", () => {
    expect(isAccessRole("forms.editor")).toBe(true);
    expect(isAccessRole("admin")).toBe(false);
    expect(isAccessRole("responses.owner")).toBe(false);
  });
});

describe("the stored name is derived from the fields (Q37 rule 1)", () => {
  it.each([
    [{ role: "responses.viewer", environments: ["test"] }, "test.responses.viewer"],
    [{ role: "responses.viewer", environments: ["prod"] }, "prod.responses.viewer"],
    [
      { role: "responses.viewer", environments: ["prod"], label: "claims" },
      "prod.responses.viewer.claims",
    ],
    [{ role: "forms.editor", environments: ["all"] }, "all.forms.editor"],
    [{ role: "forms.approver", environments: ["prod"] }, "prod.forms.approver"],
    [{ role: "forms.viewer", environments: ["all"] }, "all.forms.viewer"],
    [{ role: "responses.eraser", environments: ["all"] }, "all.responses.eraser"],
  ])("derives %o as %s", (fields, expected) => {
    expect(accessGroupNameFor(fields, LIVE)).toBe(expected);
  });

  it("derives a combined set in the environments table's order, not the caller's (Q42)", () => {
    expect(
      accessGroupNameFor({ role: "responses.viewer", environments: ["dev", "test"] }, LIVE),
    ).toBe("test-dev.responses.viewer");
  });

  it("never puts the form scope in a name", () => {
    const name = accessGroupNameFor({ role: "responses.viewer", environments: ["prod"] }, LIVE);
    expect(name).toBe("prod.responses.viewer");
  });
});

describe("a name out of step with its fields is refused on save (Q37 rule 1)", () => {
  const fields = { role: "responses.viewer", environments: ["prod"] } as const;

  it("accepts the name the fields imply", () => {
    expect(refuseAccessGroupName("prod.responses.viewer", fields, LIVE)).toBeUndefined();
  });

  it("refuses a name whose role segment is not the team's role", () => {
    const refusal = refuseAccessGroupName("prod.forms.editor", fields, LIVE);
    expect(refusal).toContain("out of step");
    expect(refusal).toContain("prod.responses.viewer");
  });

  it("refuses a name whose environments segment is not the team's scope", () => {
    expect(refuseAccessGroupName("test.responses.viewer", fields, LIVE)).toContain("out of step");
  });

  it("refuses a label that would make the dotted name unreadable back", () => {
    const refusal = refuseAccessGroupName(
      "prod.responses.viewer.a.b",
      { ...fields, label: "a.b" },
      LIVE,
    );
    expect(refusal).toContain("label");
  });

  it("refuses a name longer than a list can show", () => {
    const label = "x".repeat(200);
    expect(
      refuseAccessGroupName(`prod.responses.viewer.${label}`, { ...fields, label }, LIVE),
    ).toContain("at most");
  });
});

describe("the environment scope (Q42, Q28)", () => {
  it("accepts `all` alone", () => {
    expect(refuseEnvironmentScope(["all"], LIVE)).toBeUndefined();
  });

  it("refuses `all` beside a name, which would be two answers to one question", () => {
    expect(refuseEnvironmentScope(["all", "prod"], LIVE)).toContain("whole set");
  });

  it("refuses an empty scope", () => {
    expect(refuseEnvironmentScope([], LIVE)).toContain("cannot be empty");
  });

  it("refuses an environment that does not exist", () => {
    expect(refuseEnvironmentScope(["staging"], LIVE)).toContain("no such environment: staging");
  });

  it("refuses the same environment twice", () => {
    expect(refuseEnvironmentScope(["prod", "prod"], LIVE)).toContain("twice");
  });

  it("refuses a set out of the environments table's order, naming the one spelling (Q42)", () => {
    const refusal = refuseEnvironmentScope(["dev", "test"], LIVE);
    expect(refusal).toContain("test-dev");
  });

  it("accepts the same set in the table's order", () => {
    expect(refuseEnvironmentScope(["test", "dev"], LIVE)).toBeUndefined();
  });

  it("normalises rather than rewriting silently: both halves exist", () => {
    expect([...normaliseEnvironmentScope(["dev", "test"], LIVE)]).toEqual(["test", "dev"]);
    expect([...normaliseEnvironmentScope(["all"], LIVE)]).toEqual(["all"]);
  });
});

describe("reading a stored name back, for a reader and never for a decision (rule 2)", () => {
  it("takes position 1 as the environments, 2 and 3 as the role, the rest as the label", () => {
    expect(parseAccessGroupName("prod.responses.viewer.claims")).toEqual({
      environments: ["prod"],
      role: "responses.viewer",
      label: "claims",
    });
  });

  it("reads a name with no label", () => {
    expect(parseAccessGroupName("all.forms.editor")).toEqual({
      environments: ["all"],
      role: "forms.editor",
    });
  });

  it("splits a hyphen-joined set", () => {
    expect(parseAccessGroupName("dev-test.responses.viewer")?.environments).toEqual([
      "dev",
      "test",
    ]);
  });

  it("answers undefined for a name whose role token is not one of the six", () => {
    expect(parseAccessGroupName("prod.forms.nonsense")).toBeUndefined();
    expect(parseAccessGroupName("prod.forms")).toBeUndefined();
    expect(parseAccessGroupName("")).toBeUndefined();
  });
});

describe("the full name and the directory name are derived and never stored (Q37)", () => {
  it.each([
    ["home", "test.responses.viewer", "home.test.responses.viewer"],
    ["hr", "prod.responses.viewer.claims", "hr.prod.responses.viewer.claims"],
    ["default", "all.responses.eraser", "default.all.responses.eraser"],
  ])("derives %s + %s as %s", (slug, stored, full) => {
    expect(accessGroupFullName(slug, stored)).toBe(full);
    expect(accessGroupDirectoryName(slug, stored)).toBe(`qcms.${full}`);
  });

  it("means a slug rename changes display only", () => {
    const stored = "prod.forms.approver";
    expect(accessGroupFullName("hr", stored)).toBe("hr.prod.forms.approver");
    expect(accessGroupFullName("people", stored)).toBe("people.prod.forms.approver");
  });
});
