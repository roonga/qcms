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

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

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
    expect(Object.values(MEASURE_BY_ROUTE)).not.toContain("default");
  });

  it("counts the drawings: twelve at 1600, six at 40rem, six at 1080", () => {
    const measures = Object.values(MEASURE_BY_ROUTE);
    const count = (measure: string) => measures.filter((value) => value === measure).length;

    expect(count("wide")).toBe(12);

    expect(count("prose")).toBe(6);

    expect(count("list")).toBe(5);

    expect(count("ops")).toBe(1);
    expect(count("log")).toBe(6);
    expect(measures).toHaveLength(30);
  });

  it("offers no cap that no route can take, which is what issue 668 left behind", () => {
    expect(Object.keys(MEASURE_CLASS)).not.toContain("narrow");
    const assigned = new Set<string>(Object.values(MEASURE_BY_ROUTE));
    for (const name of Object.keys(MEASURE_CLASS)) {
      if (name === "default") continue;
      expect(assigned.has(name), `${name} is a cap some route takes`).toBe(true);
    }
  });

  it("puts every screen whose POC `.main` is 1600 on that cap", () => {
    expect(MEASURE_BY_ROUTE["/forms/[formId]"]).toBe("wide");

    expect(MEASURE_BY_ROUTE["/forms/[formId]/rules"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/operations/forms/[formId]/links"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/operations/forms/[formId]/webhooks"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/operations/forms/[formId]/responses"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/operations/forms/[formId]/responses/[sessionId]"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions"]).toBe("wide");
  });

  it("takes a POC's OUTER cap on the three screens that draw an inner element", () => {
    expect(MEASURE_BY_ROUTE["/questions/[questionId]"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/preview"]).toBe("wide");
    expect(MEASURE_BY_ROUTE["/forms/[formId]/versions/[version]"]).toBe("wide");
  });

  it("keeps the inner cap where the POC's outer layer is `none`", () => {
    expect(MEASURE_BY_ROUTE["/responses/erasures"]).toBe("log");
    expect(MEASURE_BY_ROUTE["/workspaces"]).toBe("ops");
  });

  it("leaves the one route whose drawing has no token where it was, rather than guessing", () => {
    expect(MEASURE_BY_ROUTE["/webhooks"]).toBe("wide");
    expect(Object.values(MEASURE_CLASS)).not.toContain("max-w-measure-queue");
  });

  it("gives both screens of `settings-newquestion-poc.html` its 40rem `.page-main`", () => {
    expect(MEASURE_BY_ROUTE["/settings"]).toBe("prose");
    expect(MEASURE_BY_ROUTE["/questions/new"]).toBe("prose");
  });

  it("gives the new-form screen the same 40rem, because a POC ruled it the same screen", () => {
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
    expect(measureFor("/forms/frm_auto_quote/versions/3")).toBe("wide");
    expect(measureFor("/operations/forms/frm_auto_quote/responses/ses_abc")).toBe("wide");
  });

  it("prefers a literal segment over a dynamic one, the way Next resolves them", () => {
    expect(measureFor("/questions/new")).toBe("prose");
    expect(measureFor("/questions/q_full_name")).toBe("wide");
    expect(measureFor("/responses/erasures")).toBe("log");
    expect(measureFor("/responses")).toBe("list");
  });

  it("keeps a trailing slash and a query-free path meaning the same route", () => {
    expect(measureFor("/operations/forms/frm_auto_quote/links/")).toBe("wide");
  });

  it("falls back to the readable measure for a path no route claims", () => {
    expect(measureFor("/nothing/here")).toBe("default");
    expect(measureFor("/")).toBe("default");
  });

  it("hands back the class the shell puts on its content column", () => {
    expect(measureClassFor("/settings")).toBe(MEASURE_CLASS.prose);
    expect(measureClassFor("/webhooks")).toBe(MEASURE_CLASS.wide);
    expect(measureClassFor("/forms/frm_auto_quote/preview")).toBe(MEASURE_CLASS.wide);
    expect(measureClassFor("/forms")).toBe(MEASURE_CLASS.list);
  });

  it("left-anchors every screen, because no POC centres one", () => {
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
    expect(mainClassFor("/settings")).toBe(
      "w-full max-w-measure-prose flex-1 p-(--admin-section-pad)",
    );
    expect(mainClassFor("/webhooks")).toBe(
      "w-full max-w-measure-wide flex-1 p-(--admin-section-pad)",
    );
    for (const route of Object.keys(MEASURE_BY_ROUTE)) {
      const live = route
        .split("/")
        .map((segment) => (segment.startsWith("[") ? "x" : segment))
        .join("/");
      expect(mainClassFor(live), `${route} composes its row`).toBe(
        `w-full ${MEASURE_CLASS[MEASURE_BY_ROUTE[route as keyof typeof MEASURE_BY_ROUTE]]} flex-1 p-(--admin-section-pad)`,
      );
    }
  });

  it("keeps the untraced fallback on Tailwind's own readable measure", () => {
    expect(MEASURE_CLASS.default).toBe("max-w-5xl");
    expect(mainClassFor("/nothing/here")).toBe("w-full max-w-5xl flex-1 p-(--admin-section-pad)");
  });
});
