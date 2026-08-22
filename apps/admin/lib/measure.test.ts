import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  mainClassFor,
  MEASURE_BY_ROUTE,
  MEASURE_CLASS,
  measureClassFor,
  measureFor,
} from "./measure.js";

/**
 * The route-to-cap table is the mechanism, so these are its tests (issue 558).
 *
 * `plan/admin-ux-audit.md` §6 answers the width question with three values across
 * sixteen screens, and the acceptance asks that adding a seventeenth make its cap an
 * obvious one-line decision. A table only earns that if it cannot fall out of step with
 * the route tree, so the first test here is not about widths at all: it reads the route
 * patterns off the filesystem and requires the table's keys to be exactly that set. A new
 * screen fails this test until someone writes its row, which is the one-line decision.
 */

/** The authenticated route group. Everything outside it is unauthenticated chrome. */
const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * Every Next route pattern under the shell group, read from the directory tree.
 *
 * A directory contributes a pattern when it holds a `page.tsx`; route GROUPS (the
 * `(shell)` wrapper itself and any future sibling) contribute no segment, which is what
 * makes `app/(shell)/forms/page.tsx` the pattern `/forms`. Dynamic directories keep their
 * brackets, so the pattern read here is spelled the same way the table keys are.
 *
 * PARALLEL SLOTS (`@rail`, issue 559) are skipped whole, and that is a statement about
 * what this table is for rather than a convenience. The table answers one question - how
 * wide is this screen's content column - and a slot has no content column: it renders
 * beside `<main>`, not inside it, and its pages are matched against a URL some other page
 * already owns. Counting them would ask the width question twice about one screen and
 * would make the table's own "sixteen screens" count wrong.
 */
function routePatternsUnder(directory: string, prefix: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const patterns = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [prefix === "" ? "/" : prefix]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("@")) continue;
    const segment = entry.name.startsWith("(") ? prefix : `${prefix}/${entry.name}`;
    patterns.push(...routePatternsUnder(`${directory}/${entry.name}`, segment));
  }
  return patterns;
}

describe("the route-to-cap table", () => {
  it("covers exactly the routes that exist, so a new screen has to declare its cap", () => {
    const routes = routePatternsUnder(SHELL, "").sort((a, b) => a.localeCompare(b));
    expect(Object.keys(MEASURE_BY_ROUTE).sort((a, b) => a.localeCompare(b))).toEqual(routes);
  });

  it("answers the audit's count, less the one screen its own POC re-answered", () => {
    // Five wide and two narrow are the audit's; the nine were nine until issue 655 moved
    // Settings onto the 40rem prose cap its POC draws. Eight plus that one is still the
    // audit's nine, and counting them separately is what makes the move visible here.
    const measures = Object.values(MEASURE_BY_ROUTE);
    expect(measures.filter((measure) => measure === "wide")).toHaveLength(5);
    expect(measures.filter((measure) => measure === "narrow")).toHaveLength(2);
    expect(measures.filter((measure) => measure === "default")).toHaveLength(8);
    expect(measures.filter((measure) => measure === "prose")).toHaveLength(1);
    expect(MEASURE_BY_ROUTE["/settings"]).toBe("prose");
  });

  it("assigns the five screens that earn width and the two that must not have it", () => {
    // Restated from the issue rather than derived from the table, so a wrong row is a
    // failure here instead of a table that agrees with itself.
    expect(MEASURE_BY_ROUTE["/forms/[formId]"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/webhooks"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/webhooks"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/links"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/preview"]).toBe("narrow");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions/[version]"]).toBe("narrow");
  });
});

describe("resolving a live pathname to a cap", () => {
  it("fills a dynamic segment with whatever id is in the path", () => {
    expect(measureFor("/forms/frm_auto_quote")).toBe("wide");
    expect(measureFor("/forms/frm_auto_quote/versions")).toBe("wide");
    expect(measureFor("/forms/frm_auto_quote/versions/3")).toBe("narrow");
    expect(measureFor("/forms/frm_auto_quote/responses/ses_abc")).toBe("default");
  });

  it("prefers a literal segment over a dynamic one, the way Next resolves them", () => {
    // `/questions/new` matches `/questions/[questionId]` as well; the static route wins,
    // and both are "default" today, so this is checked on the resolved pattern.
    expect(measureFor("/questions/new")).toBe("default");
    expect(measureFor("/questions/q_full_name")).toBe("default");
    expect(measureFor("/responses/erasures")).toBe("default");
  });

  it("keeps a trailing slash and a query-free path meaning the same route", () => {
    expect(measureFor("/forms/frm_auto_quote/links/")).toBe("wide");
  });

  it("falls back to the readable measure for a path no route claims", () => {
    expect(measureFor("/nothing/here")).toBe("default");
    expect(measureFor("/")).toBe("default");
  });

  it("hands back the class the shell puts on its content column", () => {
    expect(measureClassFor("/settings")).toBe(MEASURE_CLASS.prose);
    expect(measureClassFor("/webhooks")).toBe(MEASURE_CLASS.wide);
    expect(measureClassFor("/forms/frm_auto_quote/preview")).toBe(MEASURE_CLASS.narrow);
  });

  it("left-anchors the one screen whose POC draws it that way, and centres the rest", () => {
    // `margin: 0`, not `margin: 0 auto`: the POC's own statement, and the difference is
    // visible only as the absence of `mx-auto`, which is easy to reintroduce by accident.
    expect(mainClassFor("/settings")).toBe("w-full max-w-measure-prose flex-1 p-6");
    expect(mainClassFor("/settings").startsWith("mx-auto")).toBe(false);
    expect(mainClassFor("/webhooks")).toBe("mx-auto w-full max-w-measure-wide flex-1 p-6");
  });

  it("keeps every other screen's column attribute character for character", () => {
    // The clause issue 558 landed on: fifteen `<main>` elements must not move because one
    // of them did. Asserted as the whole attribute rather than as the cap alone, because
    // the alignment now comes from the same place and could drift on its own.
    for (const route of Object.keys(MEASURE_BY_ROUTE)) {
      if (route === "/settings") continue;
      expect(mainClassFor(route.replaceAll(/\[[^\]]+]/gu, "x")), `${route} is unmoved`).toBe(
        `mx-auto w-full ${MEASURE_CLASS[MEASURE_BY_ROUTE[route as keyof typeof MEASURE_BY_ROUTE]]} flex-1 p-6`,
      );
    }
  });

  it("keeps the unchanged screens on the exact class they already carried", () => {
    // The nine-screens-render-byte-identically clause, stated where it is cheap to check:
    // if this string ever drifts, those nine `<main>` elements stop being identical.
    expect(MEASURE_CLASS.default).toBe("max-w-5xl");
  });
});
