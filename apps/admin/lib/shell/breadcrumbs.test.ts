import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "../../../../scripts/tracked-files.mjs";

import { breadcrumbTrail, type Crumb } from "./breadcrumbs.ts";

const SHELL = fileURLToPath(new URL("../../app/(shell)", import.meta.url));

function labels(trail: readonly Crumb[]): string[] {
  return trail.map((crumb) => crumb.label);
}

describe("the breadcrumb", () => {
  it("reads area, then section, then item, and links every crumb but the page itself", () => {
    const trail = breadcrumbTrail("/operations/forms/frm_a/responses/ses_1", { form: "Quote" });
    expect(trail).toEqual([
      { label: "Quote" },
      { label: "Responses", href: "/operations/forms/frm_a/responses" },
      { label: "ses_1", code: true },
    ]);
  });

  it("names the editor's screens of one form under Forms", () => {
    expect(labels(breadcrumbTrail("/forms/frm_a", { form: "Quote" }))).toEqual([
      "Forms",
      "Quote",
      "Form details",
    ]);
    expect(breadcrumbTrail("/forms/frm_a/rules", { form: "Quote" })[1]).toEqual({
      label: "Quote",
      href: "/forms/frm_a",
    });
    expect(labels(breadcrumbTrail("/forms/frm_a/versions/3"))).toEqual([
      "Forms",
      "frm_a",
      "Versions",
      "Version 3",
    ]);
    expect(labels(breadcrumbTrail("/forms/new"))).toEqual(["Forms", "New form"]);
  });

  it("puts the global queues under Operations", () => {
    expect(labels(breadcrumbTrail("/webhooks"))).toEqual(["Delivery failures"]);
    expect(labels(breadcrumbTrail("/responses/erasures"))).toEqual(["Erasure log"]);
    expect(breadcrumbTrail("/operations")).toEqual([]);
  });

  it("names a workspace's section beneath the workspace", () => {
    expect(breadcrumbTrail("/workspaces/org_a/access-groups", { workspace: "Default" })).toEqual([
      { label: "Workspaces", href: "/workspaces" },
      { label: "Default", href: "/workspaces/org_a/members" },
      { label: "Access groups" },
    ]);
  });

  it("shows an identifier the address carries in the page's own face", () => {
    expect(breadcrumbTrail("/questions/q_age")).toEqual([
      { label: "Questions", href: "/questions" },
      { label: "q_age", code: true },
    ]);
  });

  it("has a trail for every screen in the shell", () => {
    const pages = trackedFilesUnder(SHELL, { match: /(?:^|\/)page\.tsx$/u }).filter(
      (file: string) => !file.startsWith("@rail/"),
    );
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      const address = page
        .replace(/(?:^|\/)page\.tsx$/u, "")
        .replace(/^/u, "/")
        .replace(/\[([A-Za-z]+)\]/gu, "x_$1");
      expect(breadcrumbTrail(address).length, address).toBeGreaterThan(0);
    }
  });
});
