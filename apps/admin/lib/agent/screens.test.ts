import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "../../../../scripts/tracked-files.mjs";

import {
  AGENT_SCREENS,
  adminPageHref,
  conversationSubject,
  screenForPath,
} from "./screens.js";

/**
 * The screen table against the route tree, the way `lib/rail-routes.test.ts` checks the
 * rail's slot: a `(shell)` page with no row would leave the assistant guessing what the
 * screen can see, and a row for a route that no longer exists is a dead screen id.
 */

const SHELL = fileURLToPath(new URL("../../app/(shell)", import.meta.url));

function shellScreens(): string[] {
  const patterns: string[] = [];
  for (const relative of trackedFilesUnder(SHELL, { match: /(?:^|\/)page\.tsx$/ })) {
    const segments = relative.split("/").slice(0, -1);
    if (segments.some((segment) => segment.startsWith("@"))) continue;
    patterns.push(
      segments
        .filter((segment) => !segment.startsWith("("))
        .map((segment) => `/${segment}`)
        .join(""),
    );
  }
  return patterns;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe("the agent screen table", () => {
  it("has a row for every authenticated page, and none for a route that is not one", () => {
    expect(sorted(AGENT_SCREENS)).toEqual(sorted(shellScreens()));
  });

  it("resolves a real path to its screen and its route ids", () => {
    expect(screenForPath("/forms")).toEqual({ screen: "/forms", params: {} });
    expect(screenForPath("/forms/new")).toEqual({ screen: "/forms/new", params: {} });
    expect(screenForPath("/forms/frm_x")).toEqual({
      screen: "/forms/[formId]",
      params: { formId: "frm_x" },
    });
    expect(screenForPath("/forms/frm_x/responses/ses_y")).toEqual({
      screen: "/forms/[formId]/responses/[sessionId]",
      params: { formId: "frm_x", sessionId: "ses_y" },
    });
    expect(screenForPath("/forms/frm_x/versions/3")).toEqual({
      screen: "/forms/[formId]/versions/[version]",
      params: { formId: "frm_x", version: 3 },
    });
    expect(screenForPath("/workspaces/wsp_a")).toEqual({
      screen: "/workspaces/[workspaceId]",
      params: { workspaceId: "wsp_a" },
    });
  });

  it("prefers a literal row over a placeholder where both would match", () => {
    expect(screenForPath("/forms/new")?.screen).toBe("/forms/new");
    expect(screenForPath("/responses/erasures")?.screen).toBe("/responses/erasures");
  });

  it("resolves no screen outside the authenticated shell", () => {
    for (const path of ["/sign-in", "/two-factor/enroll", "/change-password", "/", "/nope"]) {
      expect(screenForPath(path), path).toBeUndefined();
    }
  });

  it("keeps one conversation per form subtree and one per other screen", () => {
    const builder = screenForPath("/forms/frm_x");
    const releases = screenForPath("/forms/frm_x/releases");
    const other = screenForPath("/forms/frm_y/releases");
    expect(conversationSubject(builder)).toBe(conversationSubject(releases));
    expect(conversationSubject(other)).not.toBe(conversationSubject(builder));
    expect(conversationSubject(screenForPath("/questions"))).toBe("screen:/questions");
  });

  it("is the renderer's link allowlist, and admits no route handler", () => {
    expect(adminPageHref("/forms/frm_x/releases")).toBe("/forms/frm_x/releases");
    // The export download is a route handler, so it is not a screen and never a link.
    expect(adminPageHref("/forms/frm_x/export")).toBeUndefined();
    expect(adminPageHref("/forms/frm_x/assist")).toBeUndefined();
    expect(adminPageHref("/assist")).toBeUndefined();
    expect(adminPageHref("/forms?q=1")).toBeUndefined();
    expect(adminPageHref("/forms#x")).toBeUndefined();
    expect(adminPageHref("//evil.test/forms")).toBeUndefined();
    expect(adminPageHref("/forms/../../etc")).toBeUndefined();
    expect(adminPageHref("https://evil.test/forms")).toBeUndefined();
  });
});
