import { describe, expect, it } from "vitest";

import {
  addsResponseAccess,
  draftOf,
  draftProblem,
  groupChange,
  groupPayload,
  holdsForApproval,
  uncoveredAfterDelete,
} from "./group-edit.ts";
import { membershipRefusal } from "./refusals.ts";
import type { AccessGroup } from "./types.ts";

const ENVIRONMENTS = ["test", "prod"];

function group(
  teamId: string,
  name: string,
  roles: readonly string[],
  environments: readonly string[],
): AccessGroup {
  return { teamId, name, roles, environments, externalGroupId: null, holders: [] };
}

const STARTERS = [
  group("tm_a", "Authors", ["forms.editor", "forms.publisher", "responses.viewer"], ["test"]),
  group("tm_p", "Publishers", ["forms.publisher"], ["prod"]),
  group("tm_v", "Response viewers", ["responses.viewer"], ["prod"]),
  group("tm_e", "Response erasers", ["responses.eraser"], ["prod"]),
];

describe("saving a group (criterion 15)", () => {
  it("never sends an environment the administrator did not tick", () => {
    const payload = groupPayload(
      { name: " Authors ", roles: ["responses.viewer"], environments: ["prod", "staging"] },
      ENVIRONMENTS,
    );
    expect(payload).toEqual({
      name: "Authors",
      roles: ["responses.viewer"],
      environments: ["prod"],
    });
  });

  it("keeps an edited group's set exactly as it was when nothing is ticked anew", () => {
    const authors = STARTERS[0];
    if (authors === undefined) throw new Error("no Authors");
    expect(groupPayload(draftOf(authors), ENVIRONMENTS).environments).toEqual(["test"]);
  });

  it("drops the set from a group whose roles ignore it, even one ticked before", () => {
    expect(
      groupPayload(
        { name: "Reviewers", roles: ["forms.viewer", "forms.editor"], environments: ["prod"] },
        ENVIRONMENTS,
      ),
    ).toEqual({ name: "Reviewers", roles: ["forms.viewer", "forms.editor"], environments: [] });
  });

  it("orders roles as the site does, so one set has one spelling", () => {
    expect(
      groupPayload(
        { name: "x", roles: ["responses.eraser", "forms.viewer"], environments: ["prod"] },
        ENVIRONMENTS,
      ).roles,
    ).toEqual(["forms.viewer", "responses.eraser"]);
  });

  it("names what is missing before a save is sent", () => {
    expect(draftProblem({ name: "", roles: ["forms.viewer"], environments: [] })).toBe("name");
    expect(draftProblem({ name: "x", roles: [], environments: [] })).toBe("roles");
    expect(draftProblem({ name: "x", roles: ["responses.eraser"], environments: [] })).toBe(
      "environments",
    );
    expect(draftProblem({ name: "x", roles: ["forms.editor"], environments: [] })).toBeUndefined();
  });
});

describe("the self-grant hold", () => {
  const before = { roles: ["forms.editor"], environments: [] };

  it("holds a response role, or a new environment for one, added to the actor's own group", () => {
    expect(
      addsResponseAccess(before, {
        roles: ["forms.editor", "responses.viewer"],
        environments: ["prod"],
      }),
    ).toBe(true);
    expect(
      addsResponseAccess(
        { roles: ["responses.viewer"], environments: ["test"] },
        { roles: ["responses.viewer"], environments: ["test", "prod"] },
      ),
    ).toBe(true);
    expect(
      addsResponseAccess(undefined, { roles: ["responses.eraser"], environments: ["prod"] }),
    ).toBe(true);
  });

  it("does not hold a change that adds no response access", () => {
    expect(
      addsResponseAccess(
        { roles: ["responses.viewer"], environments: ["test", "prod"] },
        { roles: ["responses.viewer"], environments: ["prod"] },
      ),
    ).toBe(false);
    expect(addsResponseAccess(before, { roles: ["forms.publisher"], environments: ["prod"] })).toBe(
      false,
    );
  });

  it("holds only with Second approval on and the actor in the group", () => {
    const after = { roles: ["responses.viewer"], environments: ["prod"] };
    expect(
      holdsForApproval({ requireSecondApprover: true, actorInGroup: true, before, after }),
    ).toBe(true);
    expect(
      holdsForApproval({ requireSecondApprover: true, actorInGroup: false, before, after }),
    ).toBe(false);
    expect(
      holdsForApproval({ requireSecondApprover: false, actorInGroup: true, before, after }),
    ).toBe(false);
  });
});

describe("a group's change and deletion", () => {
  it("previews what the people in the group gain", () => {
    const authors = STARTERS[0];
    if (authors === undefined) throw new Error("no Authors");
    const delta = groupChange(
      authors,
      { name: "Authors", roles: [...authors.roles], environments: ["test", "prod"] },
      ENVIRONMENTS,
    );
    expect(delta.gains).toEqual([
      { role: "forms.publisher", environments: ["prod"] },
      { role: "responses.viewer", environments: ["prod"] },
    ]);
    expect(delta.losses).toEqual([]);
  });

  it("leaves Erase responses uncovered once Response erasers is deleted (criterion 96)", () => {
    expect(uncoveredAfterDelete(STARTERS, "tm_e", ENVIRONMENTS)).toEqual({
      roles: ["responses.eraser"],
      environments: [],
    });
    expect(uncoveredAfterDelete(STARTERS, "tm_p", ENVIRONMENTS).roles).toEqual([]);
  });
});

describe("a refused membership write", () => {
  it("reads the self-grant refusal as a wait, never a success", () => {
    expect(membershipRefusal({ code: "SELF_GRANT_REFUSED", message: "x" }).kind).toBe("held");
  });

  it("gives every address that cannot be added one answer", () => {
    expect(membershipRefusal({ code: "ACCOUNT_NOT_ADDABLE", message: "raw" })).toEqual({
      kind: "refused",
      message:
        "No active account can be added with that address. Check it or ask a Site administrator.",
    });
    expect(membershipRefusal({ code: "SOMETHING_ELSE", message: "shared" }).message).toBe("shared");
  });
});
