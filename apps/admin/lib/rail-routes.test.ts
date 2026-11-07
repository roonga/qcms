import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

const CURRENT_SECTION: Readonly<Record<string, string>> = {
  "/forms/[formId]": "builder",
  "/forms/[formId]/rules": "rules",
  "/forms/[formId]/preview": "preview",
  "/forms/[formId]/versions": "versions",
  "/forms/[formId]/versions/[version]": "versions",
  "/forms/[formId]/publish": "publish",
};

// Operations' rail is a second rail, not this one on another root: its slot pages name a
// row as `current="links"` where the editor's say `section: "links"`.
const CURRENT_CONTEXT: Readonly<Record<string, string>> = {
  "/operations/forms/[formId]/responses": "responses",
  "/operations/forms/[formId]/responses/[sessionId]": "responses",
  "/operations/forms/[formId]/links": "links",
  "/operations/forms/[formId]/webhooks": "webhooks",
  "/operations/forms/[formId]/intake": "intake",
  "/operations/forms/[formId]/erase": "erase",
};

const NO_SECTION: readonly string[] = [];

function routePatternsUnder(directory: string, prefix: string): string[] {
  const patterns: string[] = [];
  for (const relative of trackedFilesUnder(directory, { match: /(?:^|\/)page\.tsx$/ })) {
    const segments = relative.split("/").slice(0, -1);
    if (segments.some((segment) => segment.startsWith("@"))) continue;
    const route = segments
      .filter((segment) => !segment.startsWith("("))
      .map((segment) => `/${segment}`)
      .join("");
    patterns.push(`${prefix}${route}`);
  }
  return patterns;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function shellScreens(): string[] {
  return routePatternsUnder(SHELL, "");
}

function railSlotRoutes(): string[] {
  return routePatternsUnder(`${SHELL}/@rail`, "");
}

function formScopedScreens(): string[] {
  return shellScreens().filter((pattern) => pattern.startsWith("/forms/[formId]"));
}

function formContextScreens(): string[] {
  return shellScreens().filter((pattern) => pattern.startsWith("/operations/forms/[formId]"));
}

function slotSource(route: string): string {
  return readFileSync(`${SHELL}/@rail${route}/page.tsx`, "utf8");
}

describe("every screen has a page in the slot, whether or not it has a rail", () => {
  it("gives the slot a page for every authenticated route, and none for a route that is not one", () => {
    expect(sorted(railSlotRoutes())).toEqual(sorted(shellScreens()));
  });

  it("accounts for every route as either carrying a rail or deliberately not", () => {
    const withRail = [
      ...Object.keys(CURRENT_SECTION),
      ...Object.keys(CURRENT_CONTEXT),
      "/questions/[questionId]",
      "/settings",

      "/questions",
      "/questions/new",
      "/forms",
      "/forms/new",
      "/me/access",
      "/operations",
      "/responses",
      "/responses/erasures",
      "/webhooks",
      "/workspaces",
      "/workspaces/all",
      "/workspaces/[workspaceId]/members",
      "/workspaces/[workspaceId]/access-groups",
      "/workspaces/[workspaceId]/settings",
      "/workspaces/[workspaceId]/audit",
      "/workspaces/[workspaceId]/assistant-actions",
    ];
    expect(sorted([...withRail, ...NO_SECTION])).toEqual(sorted(shellScreens()));
  });

  it("returns null from every slot page that carries no section, and only those", () => {
    const empty = railSlotRoutes().filter((route) => slotSource(route).includes("NoRailSection"));
    expect(sorted(empty)).toEqual(sorted(NO_SECTION));
  });
});

describe("which screens carry the form-subtree section", () => {
  it("counts the screens about one form, split between the editor's and Operations'", () => {
    expect(sorted(formContextScreens())).toEqual([
      "/operations/forms/[formId]/erase",
      "/operations/forms/[formId]/intake",
      "/operations/forms/[formId]/links",
      "/operations/forms/[formId]/responses",
      "/operations/forms/[formId]/responses/[sessionId]",
      "/operations/forms/[formId]/webhooks",
    ]);
    expect(sorted(formScopedScreens())).toEqual([
      "/forms/[formId]",
      "/forms/[formId]/preview",
      "/forms/[formId]/publish",
      "/forms/[formId]/rules",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
    ]);
  });

  it("carries a rail on every root in the shell, with no screen left out", () => {
    const roots = new Set(
      railSlotRoutes()
        .filter((route) => !slotSource(route).includes("NoRailSection"))
        .map((route) => route.split("/")[1] ?? ""),
    );
    expect(sorted([...roots])).toEqual([
      "forms",
      "me",
      "operations",
      "questions",
      "responses",
      "settings",
      "webhooks",
      "workspaces",
    ]);
  });
});

describe("which of the rail's rows each screen's section carries", () => {
  it("asks for the same rail on every one of them, with nothing per-screen to keep in step", () => {
    for (const route of Object.keys(CURRENT_SECTION)) {
      expect(slotSource(route), `${route} renders the shared form rail`).toContain("FormRailSlot");
    }
    for (const route of Object.keys(CURRENT_CONTEXT)) {
      expect(slotSource(route), `${route} renders the Operations form rail`).toContain(
        "OperationsFormRailSlot",
      );
      expect(slotSource(route)).not.toContain("interactiveSteps");
    }
  });
});

describe("which row of the section each screen marks", () => {
  it("marks the section the screen is, and marks a detail route's parent section", () => {
    for (const [route, section] of Object.entries(CURRENT_SECTION)) {
      expect(slotSource(route), `${route} marks ${section} as the current rail row`).toContain(
        `section: "${section}"`,
      );
    }
  });

  it("marks the context the screen is, and marks the detail route's parent context", () => {
    for (const [route, context] of Object.entries(CURRENT_CONTEXT)) {
      expect(slotSource(route), `${route} marks ${context}`).toContain(`current="${context}"`);
    }
  });

  it("expects a current row for every slot about one form, so none can arrive unstated", () => {
    expect(sorted(Object.keys(CURRENT_SECTION))).toEqual(sorted(formScopedScreens()));
    expect(sorted(Object.keys(CURRENT_CONTEXT))).toEqual(sorted(formContextScreens()));
  });

  it("marks a step as current on no screen at all", () => {
    for (const route of Object.keys(CURRENT_SECTION)) {
      expect(slotSource(route)).not.toContain('kind: "step"');
    }
  });
});
