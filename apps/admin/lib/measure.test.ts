import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MEASURE_BY_ROUTE, MEASURE_CLASS, measureClassFor, measureFor } from "./measure.js";

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
 */
function routePatternsUnder(directory: string, prefix: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const patterns = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [prefix === "" ? "/" : prefix]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
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

  it("answers the audit's count: five wide, two narrow, nine unchanged", () => {
    const measures = Object.values(MEASURE_BY_ROUTE);
    expect(measures.filter((measure) => measure === "wide")).toHaveLength(5);
    expect(measures.filter((measure) => measure === "narrow")).toHaveLength(2);
    expect(measures.filter((measure) => measure === "default")).toHaveLength(9);
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
    expect(measureClassFor("/settings")).toBe(MEASURE_CLASS.default);
    expect(measureClassFor("/webhooks")).toBe(MEASURE_CLASS.wide);
    expect(measureClassFor("/forms/frm_auto_quote/preview")).toBe(MEASURE_CLASS.narrow);
  });

  it("keeps the unchanged screens on the exact class they already carried", () => {
    // The nine-screens-render-byte-identically clause, stated where it is cheap to check:
    // if this string ever drifts, those nine `<main>` elements stop being identical.
    expect(MEASURE_CLASS.default).toBe("max-w-5xl");
  });
});
