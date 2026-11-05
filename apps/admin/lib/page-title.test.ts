import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formSectionName, pageMetadata } from "./page-title.ts";

const APP = fileURLToPath(new URL("../app", import.meta.url));

const NO_TITLE = ["/", "/responses"];

interface Screen {
  readonly route: string;

  readonly source: string;
}

function screensUnder(directory: string, prefix: string): Screen[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const screens = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [
        {
          route: prefix === "" ? "/" : prefix,
          source: readFileSync(`${directory}/page.tsx`, "utf8"),
        },
      ]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
    const segment = entry.name.startsWith("(") ? prefix : `${prefix}/${entry.name}`;
    screens.push(...screensUnder(`${directory}/${entry.name}`, segment));
  }
  return screens;
}

function screens(): Screen[] {
  return screensUnder(APP, "");
}

function routes(): string[] {
  return screens().map((screen) => screen.route);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe("every route titles its own browser tab", () => {
  it("finds the whole route tree, so a new screen cannot be missed by the walk itself", () => {
    expect(sorted(routes())).toEqual([
      "/",
      "/change-password",
      "/forms",
      "/forms/[formId]",
      "/forms/[formId]/preview",
      "/forms/[formId]/publish",
      "/forms/[formId]/rules",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/new",
      "/me/access",
      "/operations",
      "/operations/forms/[formId]/erase",
      "/operations/forms/[formId]/intake",
      "/operations/forms/[formId]/links",
      "/operations/forms/[formId]/responses",
      "/operations/forms/[formId]/responses/[sessionId]",
      "/operations/forms/[formId]/webhooks",
      "/questions",
      "/questions/[questionId]",
      "/questions/new",
      "/responses",
      "/responses/erasures",
      "/settings",
      "/sign-in",
      "/two-factor/challenge",
      "/two-factor/enroll",
      "/two-factor/recovery",
      "/two-factor/recovery-codes",
      "/webhooks",

      "/workspaces",
      "/workspaces/[workspaceId]/access-groups",
      "/workspaces/[workspaceId]/assistant-actions",
      "/workspaces/[workspaceId]/audit",
      "/workspaces/[workspaceId]/members",
      "/workspaces/[workspaceId]/settings",
    ]);
  });

  it("exports generateMetadata from every route that renders a document", () => {
    const missing = screens()
      .filter(
        (screen) =>
          !NO_TITLE.includes(screen.route) &&
          !/^export (?:async )?function generateMetadata/m.test(screen.source),
      )
      .map((screen) => screen.route);
    expect(missing, "these routes would inherit the layout's static title").toEqual([]);
  });

  it("exempts only redirects, and only while each is still a redirect", () => {
    for (const screen of screens().filter((candidate) => NO_TITLE.includes(candidate.route))) {
      expect(screen.source, `${screen.route} is exempt because it only redirects`).toContain(
        "redirect(",
      );
      expect(screen.source).not.toContain("generateMetadata");
    }
  });

  it("builds every title through the one helper, so the pattern cannot decay per route", () => {
    const handRolled = screens()
      .filter(
        (screen) => !NO_TITLE.includes(screen.route) && !screen.source.includes("pageMetadata("),
      )
      .map((screen) => screen.route);
    expect(handRolled, "these routes compose a title without `lib/page-title.ts`").toEqual([]);
  });
});

describe("the title pattern itself", () => {
  it("puts the page name first and the app name last", () => {
    expect(pageMetadata("Questions").title).toBe("Questions - QCMS");
  });

  it("names a form's section screen by its section and its form", () => {
    expect(formSectionName("versions", "frm_life_insurance")).toBe("Versions: frm_life_insurance");
  });

  it("reads a section's name from the key the rail and the breadcrumb read", () => {
    expect(formSectionName("builder", "frm_x")).toBe("Form details: frm_x");
  });
});
