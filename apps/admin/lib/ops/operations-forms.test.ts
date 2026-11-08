import { describe, expect, it } from "vitest";

import {
  intakeOf,
  operationsApiQuery,
  operationsClearHref,
  operationsHref,
  operationsInEnvironment,
  readOperationsListState,
  type OperationsFormRow,
} from "./operations-forms.ts";

const RELEASE = { version: 3, releasedAt: "2026-10-01T00:00:00.000Z", closed: false };

const ROW: OperationsFormRow = {
  formId: "frm_intake",
  slug: "intake",
  defaultLocale: "en",
  displayName: "Intake",
  workspace: { workspaceId: "ws_1", slug: "core", name: "Core" },
  hasRelease: true,
  release: RELEASE,
  lastReleaseAt: "2026-10-01T00:00:00.000Z",
  counts: { submitted: 2, inProgress: 1 },
  capabilities: [],
};

describe("readOperationsListState", () => {
  it("reads nothing but the default order from an empty address", () => {
    expect(readOperationsListState({})).toEqual({
      environment: undefined,
      search: "",
      intake: undefined,
      sort: "slug-asc",
      cursor: undefined,
      isFiltered: false,
      activeCount: 0,
    });
  });

  it("counts the two filters and leaves the order and the page position out", () => {
    const state = readOperationsListState({
      env: "test",
      q: "intake",
      availability: "closed",
      sort: "released-desc",
      cursor: "abc",
    });
    expect(state).toMatchObject({
      environment: "test",
      search: "intake",
      intake: "closed",
      sort: "released-desc",
      cursor: "abc",
      isFiltered: true,
      activeCount: 2,
    });
  });

  it("ignores a workspace the address names: the switcher is the only chooser", () => {
    expect(readOperationsListState({ workspace: "ws_1" })).toMatchObject({ activeCount: 0 });
    expect(operationsHref(readOperationsListState({ workspace: "ws_1" }))).toBe("/operations");
  });

  it("does not count whitespace as a search", () => {
    expect(readOperationsListState({ q: "  " })).toMatchObject({ search: "  ", activeCount: 0 });
  });

  it("treats an empty parameter as absent, which is what the any option submits", () => {
    expect(readOperationsListState({ env: "", cursor: "" })).toMatchObject({
      environment: undefined,
      cursor: undefined,
    });
  });

  it("falls back to the default order rather than refusing an unknown one", () => {
    expect(readOperationsListState({ sort: "whatever" }).sort).toBe("slug-asc");
    expect(readOperationsListState({ availability: "whatever" }).intake).toBeUndefined();
    expect(readOperationsListState({ intake: "closed" }).intake).toBe("closed");
  });

  it("takes the first value of a repeated parameter", () => {
    expect(readOperationsListState({ q: ["a", "b"] })).toMatchObject({ search: "a" });
  });
});

describe("the addresses the screen links to", () => {
  const state = readOperationsListState({
    env: "test",
    q: "intake",
    availability: "open",
    sort: "released-desc",
    cursor: "page2",
  });

  it("is the whole view, in one fixed parameter order", () => {
    expect(operationsHref(state)).toBe(
      "/operations?env=test&q=intake&availability=open&sort=released-desc&cursor=page2",
    );
  });

  it("leaves the default order out, so one view is one address", () => {
    expect(operationsHref(readOperationsListState({ env: "prod", sort: "slug-asc" }))).toBe(
      "/operations?env=prod",
    );
  });

  it("replaces the page position without touching anything else", () => {
    expect(operationsHref(state, { cursor: "page3" })).toContain("cursor=page3");
    expect(operationsHref(state, { cursor: undefined })).not.toContain("cursor=");
  });

  it("resets the page when the environment moves, keeping every filter", () => {
    const moved = operationsInEnvironment(state, "prod");
    expect(moved).toMatchObject({
      environment: "prod",
      cursor: undefined,
      search: "intake",
      intake: "open",
      sort: "released-desc",
      activeCount: 2,
      isFiltered: true,
    });
    expect(operationsHref(moved)).toBe(
      "/operations?env=prod&q=intake&availability=open&sort=released-desc",
    );
  });

  it("is the same state when the address already names the environment in force", () => {
    expect(operationsInEnvironment(state, "test")).toBe(state);
  });

  it("records the environment on an address that named none", () => {
    const bare = readOperationsListState({});
    expect(operationsInEnvironment(bare, "prod")).toMatchObject({
      environment: "prod",
      activeCount: 0,
      isFiltered: false,
    });
  });

  it("clears to the same environment, which is not a filter", () => {
    expect(operationsClearHref(state)).toBe("/operations?env=test");
    expect(operationsClearHref(readOperationsListState({}))).toBe("/operations");
  });
});

describe("operationsApiQuery", () => {
  it("names the environment explicitly and sends the resolved order", () => {
    expect(operationsApiQuery(readOperationsListState({}), "prod", undefined)).toBe(
      "environment=prod&sort=slug-asc",
    );
  });

  it("names the current workspace, not one the address asked for", () => {
    const query = operationsApiQuery(
      readOperationsListState({
        q: " intake ",
        workspace: "ws_ignored",
        intake: "closed",
        cursor: "c",
      }),
      "test",
      "ws_1",
    );
    expect(query).toBe(
      "environment=test&q=intake&workspaceId=ws_1&intake=closed&sort=slug-asc&cursor=c",
    );
  });

  it("sends no term for a whitespace search", () => {
    expect(operationsApiQuery(readOperationsListState({ q: "  " }), "prod", undefined)).toBe(
      "environment=prod&sort=slug-asc",
    );
  });
});

describe("intakeOf", () => {
  it("separates no release from a closed form", () => {
    expect(intakeOf(ROW)).toBe("open");
    expect(intakeOf({ ...ROW, release: { ...RELEASE, closed: true } })).toBe("closed");
    expect(intakeOf({ ...ROW, hasRelease: false, release: null })).toBe("unreleased");
  });

  it("reports nothing when the caller holds no cell for the release", () => {
    expect(intakeOf({ ...ROW, release: null })).toBeUndefined();
  });
});
