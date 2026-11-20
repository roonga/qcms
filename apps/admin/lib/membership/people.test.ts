import { describe, expect, it } from "vitest";

import {
  isLastAdministrator,
  liveGrants,
  matchesMember,
  memberFiltersQuery,
  offersReconfirm,
  pageOf,
  peopleRows,
  readMemberFilters,
} from "./people.ts";
import type { AccessGroup, WorkspaceMember } from "./types.ts";

function member(userId: string, extra: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    userId,
    email: `${userId}@example.test`,
    name: `Person ${userId}`,
    role: "member",
    status: "active",
    groups: [],
    ...extra,
  };
}

const VIEWERS: AccessGroup = {
  teamId: "tm_viewers",
  name: "Response viewers",
  roles: ["responses.viewer"],
  environments: ["prod"],
  externalGroupId: null,
  holders: [
    { userId: "aiko", email: "aiko@example.test", suspended: true },
    { userId: "priya", email: "priya@example.test", suspended: false },
  ],
};

const AUTHORS: AccessGroup = {
  teamId: "tm_authors",
  name: "Authors",
  roles: ["forms.editor"],
  environments: [],
  externalGroupId: null,
  holders: [{ userId: "aiko", email: "aiko@example.test", suspended: false }],
};

const ROWS = peopleRows(
  [
    member("aiko"),
    member("priya", { role: "forms.owner" }),
    member("tom", { status: "disabled", role: "forms.owner" }),
    member("jordan", { status: "unclaimed", role: "forms.owner" }),
  ],
  [VIEWERS, AUTHORS],
);

function row(userId: string) {
  const found = ROWS.find((entry) => entry.userId === userId);
  if (found === undefined) throw new Error(`no row ${userId}`);
  return found;
}

describe("a member's row", () => {
  it("reads holds from the groups' own people, with each suspension", () => {
    expect(row("aiko").holds.map((hold) => [hold.group.name, hold.suspended])).toEqual([
      ["Response viewers", true],
      ["Authors", false],
    ]);
    expect(row("aiko").status).toBe("suspended");
    expect(row("priya").status).toBe("active");
    expect(row("tom").status).toBe("disabled");
    expect(row("jordan").status).toBe("unclaimed");
  });

  it("explains only what live holds grant: a suspended one grants nothing", () => {
    expect(liveGrants(row("aiko")).map((grant) => grant.name)).toEqual(["Authors"]);
  });
});

describe("the last Workspace administrator", () => {
  it("counts only active, claimed administrators, as the API's guard does", () => {
    expect(isLastAdministrator(ROWS, "priya")).toBe(true);
    expect(isLastAdministrator(ROWS, "tom")).toBe(false);
    expect(isLastAdministrator(ROWS, "aiko")).toBe(false);
  });

  it("is nobody while two count", () => {
    const two = peopleRows(
      [member("a", { role: "forms.owner" }), member("b", { role: "forms.owner" })],
      [],
    );
    expect(isLastAdministrator(two, "a")).toBe(false);
  });
});

describe("re-confirm", () => {
  it("is never offered to the membership's own subject", () => {
    expect(offersReconfirm("aiko", "aiko", true)).toBe(false);
    expect(offersReconfirm("priya", "aiko", true)).toBe(true);
    expect(offersReconfirm("priya", "aiko", false)).toBe(false);
  });
});

describe("the members filters", () => {
  it("obeys only values the screen offers", () => {
    const filters = readMemberFilters(
      { q: "  AIKO ", group: "tm_gone", administrator: "maybe", status: "bogus", page: "-2" },
      ["tm_viewers"],
    );
    expect(filters).toEqual({
      search: "AIKO",
      group: undefined,
      administrator: undefined,
      status: undefined,
      page: 1,
      activeCount: 1,
    });
  });

  it("filters by search, group, administrator and status together", () => {
    const pick = (params: Record<string, string>) =>
      ROWS.filter((entry) =>
        matchesMember(entry, readMemberFilters(params, ["tm_viewers", "tm_authors"])),
      ).map((entry) => entry.userId);
    expect(pick({ q: "PRIYA" })).toEqual(["priya"]);
    expect(pick({ group: "tm_viewers" })).toEqual(["aiko", "priya"]);
    expect(pick({ administrator: "yes" })).toEqual(["priya", "tom", "jordan"]);
    expect(pick({ administrator: "no", status: "suspended" })).toEqual(["aiko"]);
    expect(pick({ status: "disabled" })).toEqual(["tom"]);
  });

  it("writes the same filters back for another page", () => {
    const filters = readMemberFilters({ q: "a b", status: "active" }, []);
    expect(memberFiltersQuery(filters, 1)).toBe("?q=a+b&status=active");
    expect(memberFiltersQuery(filters, 3)).toBe("?q=a+b&status=active&page=3");
    expect(memberFiltersQuery(readMemberFilters({}, []), 1)).toBe("");
  });

  it("pages, clamping a page past the end to the last", () => {
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(pageOf([1, 2, 3], 9, 2)).toEqual([3]);
    expect(pageOf([], 1, 2)).toEqual([]);
  });
});
