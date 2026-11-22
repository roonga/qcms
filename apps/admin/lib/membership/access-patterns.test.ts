import { describe, expect, it } from "vitest";

import {
  accessDelta,
  describeChange,
  describeKept,
  explainAccess,
  matchesAccessFilters,
  newlyUncovered,
  readAccessFilters,
  resultRange,
  uncoveredScope,
  type GroupGrant,
} from "./access-patterns.ts";

const ENVIRONMENTS = ["test", "prod"];

const AUTHORS: GroupGrant = {
  id: "tm_authors",
  name: "Authors",
  roles: ["forms.editor", "forms.publisher", "responses.viewer"],
  environments: ["test"],
};
const REVIEWERS: GroupGrant = {
  id: "tm_reviewers",
  name: "Reviewers",
  roles: ["forms.viewer"],
  environments: [],
};
const RESPONSE_VIEWERS: GroupGrant = {
  id: "tm_rv",
  name: "Response viewers",
  roles: ["responses.viewer"],
  environments: ["prod"],
};
const PUBLISHERS: GroupGrant = {
  id: "tm_pub",
  name: "Publishers",
  roles: ["forms.publisher"],
  environments: ["prod"],
};
const ERASERS: GroupGrant = {
  id: "tm_er",
  name: "Response erasers",
  roles: ["responses.eraser"],
  environments: ["prod"],
};

function names(groups: readonly GroupGrant[]): readonly string[] {
  return groups.map((group) => group.name);
}

describe("the access explanation", () => {
  it("names the granting group per environment, and none where no group grants it", () => {
    const rows = explainAccess([AUTHORS], ENVIRONMENTS);
    const byRole = new Map(rows.map((row) => [row.role, row.cells]));

    expect(
      byRole.get("forms.viewer")?.map((cell) => [cell.environments, names(cell.groups)]),
    ).toEqual([[ENVIRONMENTS, ["Authors"]]]);
    expect(byRole.get("forms.editor")?.map((cell) => names(cell.groups))).toEqual([["Authors"]]);
    expect(byRole.get("forms.publisher")?.map((cell) => names(cell.groups))).toEqual([
      ["Authors"],
      [],
    ]);
    expect(byRole.get("responses.viewer")?.map((cell) => names(cell.groups))).toEqual([
      ["Authors"],
      [],
    ]);
    expect(byRole.get("responses.eraser")?.map((cell) => names(cell.groups))).toEqual([[], []]);
  });

  it("lists every role in the glossary's order, and every granting group in a cell", () => {
    const rows = explainAccess([AUTHORS, REVIEWERS, PUBLISHERS], ENVIRONMENTS);
    expect(rows.map((row) => row.role)).toEqual([
      "forms.viewer",
      "forms.editor",
      "forms.publisher",
      "responses.viewer",
      "responses.eraser",
    ]);
    expect(names(rows[0]?.cells[0]?.groups ?? [])).toEqual(["Authors", "Reviewers", "Publishers"]);
    expect(rows[2]?.cells.map((cell) => names(cell.groups))).toEqual([["Authors"], ["Publishers"]]);
  });

  it("grants nothing from a role it does not know", () => {
    const rows = explainAccess(
      [{ id: "x", name: "Future", roles: ["forms.future"], environments: ["prod"] }],
      ENVIRONMENTS,
    );
    expect(rows.every((row) => row.cells.every((cell) => cell.groups.length === 0))).toBe(true);
  });
});

describe("the preview before confirming", () => {
  it("adding yourself to Response viewers gains View responses in prod", () => {
    const delta = accessDelta([AUTHORS], [AUTHORS, RESPONSE_VIEWERS], ENVIRONMENTS);
    expect(delta.gains).toEqual([{ role: "responses.viewer", environments: ["prod"] }]);
    expect(delta.losses).toEqual([]);
    expect(delta.keeps).toEqual([]);
  });

  it("removing someone from Authors loses its roles and keeps View forms through Reviewers", () => {
    const delta = accessDelta([AUTHORS, REVIEWERS], [REVIEWERS], ENVIRONMENTS);
    expect(delta.gains).toEqual([]);
    expect(delta.losses).toEqual([
      { role: "forms.editor", environments: [] },
      { role: "forms.publisher", environments: ["test"] },
      { role: "responses.viewer", environments: ["test"] },
    ]);
    expect(delta.keeps).toEqual([
      { role: "forms.viewer", environments: [], groups: ["Reviewers"] },
    ]);
  });

  it("a group change counts as touched, so what it still grants is kept", () => {
    const widened = { ...AUTHORS, environments: ["test", "prod"] };
    const delta = accessDelta([AUTHORS], [widened], ENVIRONMENTS);
    expect(delta.gains).toEqual([
      { role: "forms.publisher", environments: ["prod"] },
      { role: "responses.viewer", environments: ["prod"] },
    ]);
    expect(delta.keeps.map((kept) => kept.role)).toEqual([
      "forms.viewer",
      "forms.editor",
      "forms.publisher",
      "responses.viewer",
    ]);
    expect(delta.keeps.find((kept) => kept.role === "forms.publisher")).toEqual({
      role: "forms.publisher",
      environments: ["test"],
      groups: ["Authors"],
    });
  });

  it("an untouched group is not reported as kept", () => {
    expect(accessDelta([REVIEWERS], [REVIEWERS], ENVIRONMENTS)).toEqual({
      gains: [],
      losses: [],
      keeps: [],
    });
  });

  it("says each change in plain words", () => {
    expect(describeChange({ role: "forms.editor", environments: [] }, "en-GB")).toBe("Edit forms");
    expect(
      describeChange({ role: "responses.viewer", environments: ["test", "prod"] }, "en-GB"),
    ).toBe("View responses in test and Production");
    expect(
      describeKept({ role: "forms.viewer", environments: [], groups: ["Reviewers"] }, "en-GB"),
    ).toBe("View forms through Reviewers");
  });
});

describe("what no group covers", () => {
  const STARTER = [AUTHORS, PUBLISHERS, RESPONSE_VIEWERS, ERASERS];

  it("names a new environment that no group lists", () => {
    expect(uncoveredScope(STARTER, ["test", "prod", "staging"])).toEqual({
      roles: [],
      environments: ["staging"],
    });
  });

  it("names a role left uncovered after a group is deleted", () => {
    const after = STARTER.filter((group) => group !== ERASERS);
    expect(newlyUncovered(STARTER, after, ENVIRONMENTS)).toEqual({
      roles: ["responses.eraser"],
      environments: [],
    });
  });

  it("names an environment left uncovered after a group is changed", () => {
    const before = [AUTHORS, PUBLISHERS];
    const after = [AUTHORS, { ...PUBLISHERS, environments: ["test"] }];
    expect(newlyUncovered(before, after, ENVIRONMENTS)).toEqual({
      roles: [],
      environments: ["prod"],
    });
  });

  it("does not repeat what was already uncovered", () => {
    expect(newlyUncovered([AUTHORS], [AUTHORS], ENVIRONMENTS)).toEqual({
      roles: [],
      environments: [],
    });
  });
});

describe("search and rail filters", () => {
  const OPTIONS = {
    roles: ["forms.editor", "responses.viewer"],
    environments: ENVIRONMENTS,
    statuses: ["active", "suspended"] as const,
  };

  it("reads what the query string asks for and counts the active filters", () => {
    expect(
      readAccessFilters(
        { q: "  priya ", role: "forms.editor", environment: "prod", status: "suspended" },
        OPTIONS,
      ),
    ).toEqual({
      search: "priya",
      role: "forms.editor",
      environment: "prod",
      status: "suspended",
      activeCount: 4,
    });
  });

  it("drops a value the screen does not offer instead of obeying it", () => {
    expect(
      readAccessFilters(
        { q: "", role: "forms.owner", environment: "staging", status: "disabled" },
        OPTIONS,
      ),
    ).toEqual({
      search: "",
      role: undefined,
      environment: undefined,
      status: undefined,
      activeCount: 0,
    });
  });

  it("takes the first of a repeated parameter and bounds the search", () => {
    const filters = readAccessFilters(
      { q: ["a".repeat(300), "b"], role: ["responses.viewer"] },
      OPTIONS,
    );
    expect(filters.search).toHaveLength(200);
    expect(filters.role).toBe("responses.viewer");
  });

  it("matches name or email, ignoring case, and every chosen filter", () => {
    const entry = {
      name: "Priya Shah",
      email: "priya@qcms.test",
      roles: ["forms.editor"],
      environments: ["test"],
      status: "active" as const,
    };
    const all = readAccessFilters({}, OPTIONS);
    expect(matchesAccessFilters(entry, all)).toBe(true);
    expect(matchesAccessFilters(entry, { ...all, search: "SHAH" })).toBe(true);
    expect(matchesAccessFilters(entry, { ...all, search: "qcms.test" })).toBe(true);
    expect(matchesAccessFilters(entry, { ...all, search: "sam" })).toBe(false);
    expect(matchesAccessFilters(entry, { ...all, role: "responses.viewer" })).toBe(false);
    expect(matchesAccessFilters(entry, { ...all, environment: "prod" })).toBe(false);
    expect(matchesAccessFilters(entry, { ...all, status: "suspended" })).toBe(false);
    expect(
      matchesAccessFilters(entry, {
        ...all,
        role: "forms.editor",
        environment: "test",
        status: "active",
      }),
    ).toBe(true);
  });

  it("states the rows a page shows and the pages either side", () => {
    expect(resultRange(1, 25, 1000)).toEqual({
      first: 1,
      last: 25,
      total: 1000,
      previous: undefined,
      next: 2,
    });
    expect(resultRange(40, 25, 1000)).toEqual({
      first: 976,
      last: 1000,
      total: 1000,
      previous: 39,
      next: undefined,
    });
    expect(resultRange(99, 25, 30)).toMatchObject({ first: 26, last: 30, previous: 1 });
    expect(resultRange(1, 25, 0)).toEqual({
      first: 0,
      last: 0,
      total: 0,
      previous: undefined,
      next: undefined,
    });
  });
});
