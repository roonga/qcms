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
 * The route-to-cap table is the mechanism, so these are its tests (issues 558, 648, 657).
 *
 * Each of the seventeen screens takes the cap its own POC draws, and the acceptance asks
 * that adding one more make its cap an obvious one-line decision. Issue 685 is the first
 * time that promise was called in: `/forms/new` arrived and its cap was one row. A table
 * only earns
 * that if it cannot fall out of step with the route tree, so the first test here is not
 * about widths at all: it reads the route patterns off the filesystem and requires the
 * table's keys to be exactly that set. A new screen fails this test until someone writes
 * its row, which is the one-line decision.
 *
 * The values below are restated from the POCs rather than imported from `measure.ts`.
 * Importing them would make this file agree with the table by construction; written out,
 * a row that says the wrong thing fails here.
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
 * would make the table's own screen count wrong.
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

  it("assigns every route a cap some POC draws, and no route the untraced default", () => {
    // The clause issue 657 landed on. `default` is Tailwind's `max-w-5xl` and no POC puts
    // 1024 on anything; it survives only as `measureFor`'s fallback for a path no route
    // claims. A row that drifts back onto it is a row that has stopped tracing to a
    // drawing, which is the exact failure this issue existed to fix.
    expect(Object.values(MEASURE_BY_ROUTE)).not.toContain("default");
  });

  it("counts the drawings: seven at 1600, three narrow, three at 40rem, two at 1080", () => {
    // Restated from the POCs rather than derived from the table, so a wrong row is a
    // failure here instead of a table that agrees with itself.
    const measures = Object.values(MEASURE_BY_ROUTE);
    const count = (measure: string) => measures.filter((value) => value === measure).length;
    expect(count("wide")).toBe(7);
    expect(count("narrow")).toBe(3);
    expect(count("prose")).toBe(3);
    expect(count("list")).toBe(2);
    expect(count("ops")).toBe(1);
    expect(count("log")).toBe(1);
    expect(measures).toHaveLength(17);
  });

  it("puts the six screens whose POC `.main` is 1600 on that cap", () => {
    // `admin-shell-poc.html`, `links-webhooks-poc.html` (both screens), `responses-poc.html`
    // (both screens) and the version-history screen of `preview-versions-poc.html`. The
    // last of those is the case that shows a shared `.main` is NOT ignored in a
    // multi-screen file: two of that file's three screens draw an inner cap and this one
    // does not, so this one takes the shared number.
    expect(MEASURE_BY_ROUTE["/forms/[formId]"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/links"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/webhooks"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/responses"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/responses/[sessionId]"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions"]).toBe("wide");
  });

  it("takes the inner cap wherever a POC draws one inside its `.main`", () => {
    // The two-layer reading, stated as its consequences. Each of these routes' POC caps
    // `.main` at 1600 or leaves it uncapped, and then caps the screen's own content
    // narrower; the inner number is what a reader sees, so it is what the route takes.
    // The two respondent-facing screens land on `narrow` rather than on the 640 they draw
    // because the drawn 640 is a frame inside `.main`'s padding while this cap sits on a
    // `<main>` that pads by 24 a side: 45rem renders 672, 40rem would render 592, and 672
    // is the closer of the two to 640. It is also the value they already had.
    expect(MEASURE_BY_ROUTE["/questions/[questionId]"]).toBe("narrow"); // .editor-column 720
    expect(MEASURE_BY_ROUTE["/forms/[formId]/preview"]).toBe("narrow"); // .respondent-frame 640
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions/[version]"]).toBe("narrow"); // same frame
    expect(MEASURE_BY_ROUTE["/responses"]).toBe("ops"); // .ops-inner--responses 900
    expect(MEASURE_BY_ROUTE["/responses/erasures"]).toBe("log"); // .ops-inner--erasures 1180
  });

  it("leaves the one route whose drawing has no token where it was, rather than guessing", () => {
    // `deployment-ops-poc.html` `.ops-inner--webhooks` is 1820, wider than `wide`. It
    // cannot be reached by reassignment, only by adding a value to the vocabulary, which
    // is a change to the scheme rather than a row in this table. Pinned here so the open
    // question is visible in the suite rather than only in a comment.
    expect(MEASURE_BY_ROUTE["/webhooks"]).toBe("wide");
    expect(Object.values(MEASURE_CLASS)).not.toContain("max-w-measure-queue");
  });

  it("gives both screens of `settings-newquestion-poc.html` its 40rem `.page-main`", () => {
    // One POC file, two screens, one cap. `/settings` arrived in issue 655; `/questions/new`
    // is the screen that file draws beside it and issue 657's own table did not list.
    expect(MEASURE_BY_ROUTE["/settings"]).toBe("prose");
    expect(MEASURE_BY_ROUTE["/questions/new"]).toBe("prose");
  });

  it("gives the new-form screen the same 40rem, because a POC ruled it the same screen", () => {
    // The seventeenth row (issue 685), and the only one reached by a step. No POC draws
    // `/forms/new`; `library-lists-poc.html` rules that BOTH library screens create on a
    // separate route and names `/questions/new` as the model, so the model's drawing is
    // this screen's drawing too. Pinned as its own case rather than folded into the one
    // above, because "the same as its model" is the claim, and a later pass that widened
    // the creating screens apart should have to argue with a sentence rather than change
    // a number in a list.
    expect(MEASURE_BY_ROUTE["/forms/new"]).toBe(MEASURE_BY_ROUTE["/questions/new"]);
    expect(MEASURE_BY_ROUTE["/forms/new"]).toBe("prose");
  });

  it("gives both screens of `library-lists-poc.html` its 1080px `.main`", () => {
    expect(MEASURE_BY_ROUTE["/forms"]).toBe("list");
    expect(MEASURE_BY_ROUTE["/questions"]).toBe("list");
  });
});

describe("resolving a live pathname to a cap", () => {
  it("fills a dynamic segment with whatever id is in the path", () => {
    expect(measureFor("/forms/frm_auto_quote")).toBe("wide");
    expect(measureFor("/forms/frm_auto_quote/versions")).toBe("wide");
    expect(measureFor("/forms/frm_auto_quote/versions/3")).toBe("narrow");
    expect(measureFor("/forms/frm_auto_quote/responses/ses_abc")).toBe("wide");
  });

  it("prefers a literal segment over a dynamic one, the way Next resolves them", () => {
    // `/questions/new` matches `/questions/[questionId]` as well and the static route wins.
    // Since issue 657 the two take DIFFERENT caps - a 40rem form and a 720px editor - so
    // this is now a resolution the rendered width depends on rather than a tie.
    expect(measureFor("/questions/new")).toBe("prose");
    expect(measureFor("/questions/q_full_name")).toBe("narrow");
    expect(measureFor("/responses/erasures")).toBe("log");
    expect(measureFor("/responses")).toBe("ops");
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
    expect(measureClassFor("/forms")).toBe(MEASURE_CLASS.list);
  });

  it("left-anchors every screen, because no POC centres one", () => {
    // `margin: 0`, not `margin: 0 auto`: `settings-newquestion-poc.html`'s own statement,
    // and all eleven POCs were read for a centring rule on the main column with no hits.
    // The difference is visible only as the ABSENCE of `mx-auto`, which is easy to
    // reintroduce by accident, so it is asserted on every route rather than sampled.
    for (const route of Object.keys(MEASURE_BY_ROUTE)) {
      const live = route
        .split("/")
        .map((segment) => (segment.startsWith("[") ? "x" : segment))
        .join("/");
      expect(mainClassFor(live), `${route} is left-anchored`).not.toContain("mx-auto");
    }
    expect(mainClassFor("/nothing/here"), "and so is an unknown path").not.toContain("mx-auto");
  });

  it("composes the cap and the alignment into one attribute per route", () => {
    expect(mainClassFor("/settings")).toBe("w-full max-w-measure-prose flex-1 p-6");
    expect(mainClassFor("/webhooks")).toBe("w-full max-w-measure-wide flex-1 p-6");
    for (const route of Object.keys(MEASURE_BY_ROUTE)) {
      const live = route
        .split("/")
        .map((segment) => (segment.startsWith("[") ? "x" : segment))
        .join("/");
      expect(mainClassFor(live), `${route} composes its row`).toBe(
        `w-full ${MEASURE_CLASS[MEASURE_BY_ROUTE[route as keyof typeof MEASURE_BY_ROUTE]]} flex-1 p-6`,
      );
    }
  });

  it("keeps the untraced fallback on Tailwind's own readable measure", () => {
    expect(MEASURE_CLASS.default).toBe("max-w-5xl");
    expect(mainClassFor("/nothing/here")).toBe("w-full max-w-5xl flex-1 p-6");
  });
});
