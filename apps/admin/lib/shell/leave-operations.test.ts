import { describe, expect, it } from "vitest";

import {
  leaveDestination,
  leavesOperations,
  operationsExitHref,
  plainNavigation,
  rememberedReturn,
  type AnchorFacts,
  type ClickFacts,
} from "./leave-operations.ts";
import { NO_CAPABILITIES, type ShellCapabilities } from "./modes.ts";

const ORIGIN = "https://admin.example";

const PLAIN: ClickFacts = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

function anchor(href: string, partial: Partial<AnchorFacts> = {}): AnchorFacts {
  return { href, target: "", download: false, exempt: false, ...partial };
}

const EVERYTHING: ShellCapabilities = {
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: false,
};

describe("leaving Operations", () => {
  it("is any move from Operations to an address outside it", () => {
    expect(leavesOperations("/operations", "/forms/frm_a", undefined)).toBe(true);
    expect(leavesOperations("/operations/forms/frm_a/responses", "/questions", undefined)).toBe(
      true,
    );
    expect(leavesOperations("/webhooks", "/workspaces", undefined)).toBe(true);
  });

  it("is not a move inside Operations, including its global queues", () => {
    expect(leavesOperations("/operations", "/operations/forms/frm_a/links", undefined)).toBe(false);
    expect(leavesOperations("/operations", "/webhooks", undefined)).toBe(false);
    expect(leavesOperations("/operations", "/responses/erasures", undefined)).toBe(false);
  });

  it("keeps personal routes inside the mode they were opened from", () => {
    expect(leavesOperations("/operations", "/settings", undefined)).toBe(false);
    expect(leavesOperations("/operations", "/me/access", undefined)).toBe(false);
    expect(leavesOperations("/settings", "/forms", "operations")).toBe(true);
  });

  it("never warns outside Operations", () => {
    expect(leavesOperations("/forms", "/questions", undefined)).toBe(false);
    expect(leavesOperations("/settings", "/forms", "normal")).toBe(false);
  });

  it("names the area the link opens", () => {
    expect(leaveDestination("/forms/frm_a/versions")).toBe("forms");
    expect(leaveDestination("/questions")).toBe("questions");
    expect(leaveDestination("/workspaces/ws_a")).toBe("workspaces");
    expect(leaveDestination("/")).toBe("elsewhere");
  });
});

describe("a plain navigation", () => {
  it("is a same-origin path with its query and fragment", () => {
    expect(plainNavigation(PLAIN, anchor(`${ORIGIN}/forms/frm_a?x=1#h`), ORIGIN)).toBe(
      "/forms/frm_a?x=1#h",
    );
  });

  it("is not a click the browser opens elsewhere", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(plainNavigation({ ...PLAIN, [key]: true }, anchor("/forms"), ORIGIN)).toBeUndefined();
    }
    expect(plainNavigation({ ...PLAIN, button: 1 }, anchor("/forms"), ORIGIN)).toBeUndefined();
    expect(plainNavigation(PLAIN, anchor("/forms", { target: "_blank" }), ORIGIN)).toBeUndefined();
    expect(plainNavigation(PLAIN, anchor("/forms", { download: true }), ORIGIN)).toBeUndefined();
    expect(plainNavigation(PLAIN, anchor("https://other.example/forms"), ORIGIN)).toBeUndefined();
  });

  it("is not the exempt Exit control or a click already handled", () => {
    expect(plainNavigation(PLAIN, anchor("/questions", { exempt: true }), ORIGIN)).toBeUndefined();
    expect(
      plainNavigation({ ...PLAIN, defaultPrevented: true }, anchor("/questions"), ORIGIN),
    ).toBeUndefined();
    expect(plainNavigation(PLAIN, anchor("/questions", { target: "_self" }), ORIGIN)).toBe(
      "/questions",
    );
  });
});

describe("where Exit Operations goes", () => {
  it("is where the operator came from", () => {
    expect(operationsExitHref("/forms/frm_a/rules?step=2", EVERYTHING, "/questions")).toBe(
      "/forms/frm_a/rules?step=2",
    );
    expect(operationsExitHref("/workspaces/ws_a", EVERYTHING, "/questions")).toBe(
      "/workspaces/ws_a",
    );
  });

  it("falls back when that is unknown or not a place Exit may go", () => {
    expect(operationsExitHref(null, EVERYTHING, "/questions")).toBe("/questions");
    expect(operationsExitHref("//evil.example/x", EVERYTHING, "/questions")).toBe("/questions");
    expect(operationsExitHref("/\\evil.example", EVERYTHING, "/questions")).toBe("/questions");
    expect(operationsExitHref("https://evil.example", EVERYTHING, "/questions")).toBe("/questions");
    expect(operationsExitHref("/operations/forms/frm_a", EVERYTHING, "/questions")).toBe(
      "/questions",
    );
    expect(operationsExitHref("/settings", EVERYTHING, "/questions")).toBe("/questions");
  });

  it("falls back when the caller no longer holds the area", () => {
    const authoringOnly = { ...NO_CAPABILITIES, authoring: true, operations: true };
    expect(operationsExitHref("/workspaces/ws_a", authoringOnly, "/questions")).toBe("/questions");
  });

  it("remembers only addresses outside Operations and the personal routes", () => {
    expect(rememberedReturn("/forms/frm_a", "?q=1")).toBe("/forms/frm_a?q=1");
    expect(rememberedReturn("/operations", "")).toBeUndefined();
    expect(rememberedReturn("/webhooks", "")).toBeUndefined();
    expect(rememberedReturn("/settings", "")).toBeUndefined();
  });
});
