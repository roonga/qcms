import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formSectionName, pageMetadata } from "./page-title.ts";

/**
 * Every route names its own browser tab, checked against the route tree rather than
 * claimed (issue #536).
 *
 * ## What this is defending
 *
 * `app/layout.tsx` sets a static `title`, and Next uses it for any route that does not
 * define its own. That is a fallback with no failure mode: a route added without a title
 * renders, passes every other gate, and is simply indistinguishable from every other tab
 * in the strip - which is the whole of the defect issue #536 was filed for, on sixteen
 * routes at once. Nothing in a type, a lint rule or a browser spec fails on it, so the
 * property is pinned here, by walking the same tree `rail-routes.test.ts` walks.
 *
 * ## The two halves, and why the second one is not decoration
 *
 * Having *a* title is the first rule. Building it through {@link pageMetadata} is the
 * second, and it is what keeps `<page> - QCMS` one pattern rather than a convention that
 * decays route by route: a hand-written `return { title: "Forms" }` satisfies the first
 * rule, drops the app name, and hard-codes a user-facing string past ADR-27's catalog
 * while it is at it.
 *
 * ## Slot pages are not routes
 *
 * `app/(shell)/@rail/**` has a page for all seventeen screens (that is the property
 * `rail-routes.test.ts` pins) and none of them is a document. Next resolves metadata from
 * the matched segment's own `page.tsx`, so a `generateMetadata` in a parallel-route slot
 * would be dead code claiming to be a title. Skipped by the same `@` rule the sibling
 * walk uses.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));

/**
 * The one route with no title, and the reason it needs none.
 *
 * `app/page.tsx` renders nothing: it reads the session and `redirect()`s to the shell or
 * to sign-in, so no document it could title is ever produced. Listed rather than pattern-
 * matched, so a second exemption is a line someone writes and a reviewer reads.
 */
const NO_TITLE = ["/"];

/** One screen: the route pattern it answers, and the file that answers it. */
interface Screen {
  /** The URL pattern, with route groups contributing no segment. */
  readonly route: string;
  /** The page's own source, read once. */
  readonly source: string;
}

/**
 * Every screen with a page, slot trees excluded.
 *
 * The route pattern and the file are carried together rather than derived from each
 * other: a route group means the two disagree by a segment (`/forms` is served from
 * `app/(shell)/forms/page.tsx`), so a path rebuilt from a pattern reads the wrong file
 * or none at all.
 */
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

/** Every screen the app serves: authenticated, auth-flow and root alike. */
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
    // Restated rather than derived, for the same reason `rail-routes.test.ts` restates its
    // section list: a walk checked against its own output passes on any tree. A route
    // added or removed changes this list, which is what puts it in front of a reviewer.
    expect(sorted(routes())).toEqual([
      "/",
      "/forms",
      "/forms/[formId]",
      "/forms/[formId]/links",
      "/forms/[formId]/preview",
      "/forms/[formId]/responses",
      "/forms/[formId]/responses/[sessionId]",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/[formId]/webhooks",
      "/forms/new",
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

  it("exempts only the redirect, and only while it is still a redirect", () => {
    // The exemption is spent the moment `/` renders anything, so it is checked rather
    // than trusted: a landing page arriving under this list would be a screen with no
    // title and no reviewer asked about it.
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
    // Asserted as the whole string, because the ORDER is the decision (see `app.pageTitle`
    // in the catalog): a tab strip truncates from the right, so the half that survives has
    // to be the half that differs between two tabs.
    expect(pageMetadata("Questions").title).toBe("Questions - QCMS");
  });

  it("names a form's section screen by its section and its form", () => {
    expect(formSectionName("versions", "frm_life_insurance")).toBe(
      "Version history: frm_life_insurance",
    );
  });

  it("reads a section's name from the key the rail and the breadcrumb read", () => {
    // Not a second vocabulary: `forms.tab.builder` is "Form details" everywhere, and a tab
    // saying "Builder" while the rail row says "Form details" is the drift this pins shut.
    expect(formSectionName("builder", "frm_x")).toBe("Form details: frm_x");
  });
});
