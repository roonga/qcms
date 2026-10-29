import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createJsonLogger } from "@roonga/qcms-observability/logger";
import { allowlistingLogRecordProcessor, safeEventName } from "@roonga/qcms-observability/logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BELTED_ROUTE_TEMPLATES,
  ORIGIN_BELT_REFUSED,
  classifyFetchSite,
  classifyOrigin,
  classifyRoute,
  logOriginBeltRefusal,
  originBeltRefusal,
  routeOutcome,
} from "./origin-belt-log";
import { trackedFilesUnder } from "../../../../scripts/tracked-files.mjs";
import { declaresUseServer } from "../../../../scripts/use-server-directive.mjs";

const PORTAL_BASE = "https://forms.qcms.test";

/**
 * Planted in every request-controlled input the belt can see, and distinctive enough
 * that a substring scan over the emitted line is a complete check rather than a
 * suggestive one.
 */
const CANARIES = {
  origin: "https://BELT_ORIGIN_CANARY.example",
  sessionId: "ses_BELT_SESSION_CANARY",
  slug: "BELT_SLUG_CANARY",
  fetchSite: "BELT_FETCHSITE_CANARY",
  cookie: "qcms_session=BELT_TOKEN_CANARY",
  authorization: "Bearer BELT_BEARER_CANARY",
  query: "answer=BELT_ANSWER_CANARY",
} as const;

const CANARY_PATTERN = /BELT_[A-Z]+_CANARY/;

function stubPortalEnv(): void {
  vi.stubEnv("QCMS_PORTAL_BASE_URL", PORTAL_BASE);
}

beforeEach(stubPortalEnv);
afterEach(() => {
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ *
 * 1. The route set, derived from disk
 * ------------------------------------------------------------------ */

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

/**
 * One constant rather than the same literal list at each assertion: a member added to
 * `BeltOutcome` without a home in the runbook should fail in one obvious place, not in
 * three that happen to agree.
 */
const OUTCOME_VOCABULARY = [
  "redirect-to-entry",
  "redirect-to-root",
  "redirect-to-step",
  "rendered-unchanged",
  "forbidden",
];

/** The verbs whose handlers change state, so the belt applies to them. */
const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const EXPORTED_HANDLER = /^export (?:async )?function (\w+)\s*\(/m;

/**
 * Enumerated through git rather than by walking the directory, so a compiled handler left
 * under `.next-dev` by a dev server is not read as a route.
 */
function routeFiles(dir: string, prefix: string): string[] {
  return trackedFilesUnder(dir, { match: /(?:^|\/)route\.tsx?$/ }).map(
    (relative) => `${prefix}${relative}`,
  );
}

function templateOf(relativePath: string): string {
  const segments = relativePath.split("/").slice(0, -1);
  return `/${segments.map((s) => s.replace(/^\[(.+)]$/, "{$1}")).join("/")}`;
}

/** With a canary in every dynamic segment. */
function concreteUrl(template: string): string {
  return `${PORTAL_BASE}${template.replaceAll(/\{\w+}/g, CANARIES.slug)}`;
}

/**
 * A Server Action is a state-changing entry point that is not a `route.ts` and runs the
 * belt itself (R-B2), so it belongs in the enumeration below rather than beside it, or
 * the table's two-directional check would report its `BeltRoute` entry as an orphan.
 */
function serverActionFiles(): string[] {
  return trackedFilesUnder(APP_DIR, { match: /\.tsx?$/ }).filter((relative) => {
    const source = readFileSync(`${APP_DIR}/${relative}`, "utf8");
    return declaresUseServer(source);
  });
}

/**
 * The page that declares it, because an action is posted to the route of the page whose
 * form carries it rather than to a path of its own. That is also why its belt entry
 * cannot be derived by `templateOf`, which reads a `route.ts`'s own directory.
 */
function actionTemplateOf(relativePath: string): string {
  const segments = relativePath.split("/").slice(0, -1);
  return `/${segments.map((s) => s.replace(/^\[(.+)]$/, "{$1}")).join("/")}`;
}

/**
 * The enumeration: it reads the tree rather than a list, so a belted route or Server
 * Action added tomorrow appears here without anyone remembering this file exists.
 */
const MUTATING_ROUTE_TEMPLATES: string[] = [
  ...routeFiles(APP_DIR, "")
    .filter((relative) => {
      const source = readFileSync(`${APP_DIR}/${relative}`, "utf8");
      return source
        .split("\n")
        .some((line) => MUTATING_VERBS.has(EXPORTED_HANDLER.exec(line)?.[1] ?? ""));
    })
    .map(templateOf),
  ...serverActionFiles().map(actionTemplateOf),
]
  .filter((template, index, all) => all.indexOf(template) === index)
  .sort((a, b) => a.localeCompare(b));

describe("the belted route set is the one on disk", () => {
  it("finds state-changing route handlers to enumerate", () => {
    expect(MUTATING_ROUTE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("recognises every state-changing route in the tree, and only those", () => {
    expect(MUTATING_ROUTE_TEMPLATES).toEqual(
      [...BELTED_ROUTE_TEMPLATES].sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each(MUTATING_ROUTE_TEMPLATES)("classifies a request to %s as that template", (template) => {
    expect(classifyRoute(concreteUrl(template))).toBe(template);
  });

  it.each(MUTATING_ROUTE_TEMPLATES)("names an outcome for %s", (template) => {
    expect(OUTCOME_VOCABULARY).toContain(routeOutcome(concreteUrl(template)));
  });

  it("does not stretch a template over a path that is merely similar", () => {
    expect(classifyRoute(`${PORTAL_BASE}/s/ses_1/step/extra`)).toBe("unrecognized");
    expect(classifyRoute(`${PORTAL_BASE}/l/lnk_1`)).toBe("unrecognized");
    expect(classifyRoute(`${PORTAL_BASE}/appearance/extra`)).toBe("unrecognized");
    expect(classifyRoute(`${PORTAL_BASE}/appearances`)).toBe("unrecognized");
  });

  it("survives a URL it cannot parse rather than throwing inside the belt", () => {
    expect(classifyRoute("not a url")).toBe("unrecognized");
    expect(routeOutcome("not a url")).toBe("forbidden");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Every field is a member of a declared vocabulary
 * ------------------------------------------------------------------ */

const FETCH_SITE_VOCABULARY = ["absent", "same-origin", "same-site", "cross-site", "none", "other"];
const ORIGIN_VOCABULARY = ["absent", "null", "match", "mismatch", "unverifiable"];

/** A request carrying a canary in every input the belt can read. */
function hostileRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${PORTAL_BASE}/s/${CANARIES.sessionId}/submit?${CANARIES.query}`, {
    method: "POST",
    headers: {
      origin: CANARIES.origin,
      cookie: CANARIES.cookie,
      authorization: CANARIES.authorization,
      referer: `${PORTAL_BASE}/f/${CANARIES.slug}`,
      ...headers,
    },
  });
}

describe("classifying, never copying", () => {
  it.each([
    ["same-origin", "same-origin"],
    ["same-site", "same-site"],
    ["cross-site", "cross-site"],
    ["none", "none"],
    [CANARIES.fetchSite, "other"],
    ["", "other"],
  ])("reads Sec-Fetch-Site %s as %s", (header, expected) => {
    expect(classifyFetchSite(hostileRequest({ "sec-fetch-site": header }))).toBe(expected);
  });

  it("reads an absent Sec-Fetch-Site as absent, which is the population being counted", () => {
    expect(
      classifyFetchSite(new Request(`${PORTAL_BASE}/s/ses_1/submit`, { method: "POST" })),
    ).toBe("absent");
  });

  it.each([
    [CANARIES.origin, "mismatch"],
    [PORTAL_BASE, "match"],
    ["null", "null"],
  ])("reads Origin %s as %s", (header, expected) => {
    expect(classifyOrigin(hostileRequest({ origin: header }))).toBe(expected);
  });

  it("reads an absent Origin as absent", () => {
    expect(classifyOrigin(new Request(`${PORTAL_BASE}/s/ses_1/submit`, { method: "POST" }))).toBe(
      "absent",
    );
  });

  it("reports an unverifiable Origin rather than throwing when the base URL is unset", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
    expect(classifyOrigin(hostileRequest())).toBe("unverifiable");
  });

  it("emits only vocabulary members, whatever the request carries", () => {
    for (const fetchSite of ["cross-site", CANARIES.fetchSite, ""]) {
      const fields = originBeltRefusal(hostileRequest({ "sec-fetch-site": fetchSite }));
      expect(FETCH_SITE_VOCABULARY).toContain(fields.beltFetchSite);
      expect(ORIGIN_VOCABULARY).toContain(fields.beltOrigin);
      expect(BELTED_ROUTE_TEMPLATES).toContain(fields.beltRoute);
      expect(OUTCOME_VOCABULARY).toContain(fields.beltOutcome);
    }
  });
});

describe("SEC-13: nothing the request supplied reaches the line", () => {
  it("writes no canary to stdout, from any input the belt can see", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      base: { service: "qcms-portal" },
      write: (l) => lines.push(l),
    });
    logger.warn(ORIGIN_BELT_REFUSED, { ...originBeltRefusal(hostileRequest()) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(CANARY_PATTERN);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      level: "warn",
      time: expect.any(String) as string,
      service: "qcms-portal",
      beltRoute: "/s/{sessionId}/submit",
      beltFetchSite: "absent",
      beltOrigin: "mismatch",
      beltOutcome: "forbidden",
      msg: ORIGIN_BELT_REFUSED,
    });
  });

  it("goes through the module's own emitter, not only the fields it builds", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      logOriginBeltRefusal(hostileRequest({ "sec-fetch-site": "cross-site" }));
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0]?.[0] ?? "");
      expect(line).not.toMatch(CANARY_PATTERN);
      expect(JSON.parse(line) as Record<string, unknown>).toMatchObject({
        level: "warn",
        msg: ORIGIN_BELT_REFUSED,
        beltFetchSite: "cross-site",
        beltOrigin: "mismatch",
        beltRoute: "/s/{sessionId}/submit",
        beltOutcome: "forbidden",
      });
    } finally {
      write.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. The line survives the export allowlist intact
 * ------------------------------------------------------------------ */

describe("SEC-13: the exported record keeps the line rather than collapsing it", () => {
  it("keeps the event name", () => {
    expect(safeEventName(ORIGIN_BELT_REFUSED)).toBe(ORIGIN_BELT_REFUSED);
  });

  it("keeps the four fields and deletes anything else on the same record", () => {
    const attributes: Record<string, unknown> = {
      ...originBeltRefusal(hostileRequest({ "sec-fetch-site": "cross-site" })),
      rawOrigin: CANARIES.origin,
    };
    const record = {
      body: ORIGIN_BELT_REFUSED,
      attributes,
      setBody: vi.fn(function (this: { body: unknown }, body: unknown) {
        this.body = body;
        return this;
      }),
    };

    allowlistingLogRecordProcessor().onEmit(record as never);

    expect(record.body).toBe(ORIGIN_BELT_REFUSED);
    expect(attributes).toEqual({
      beltRoute: "/s/{sessionId}/submit",
      beltFetchSite: "cross-site",
      beltOrigin: "mismatch",
      beltOutcome: "forbidden",
    });
    expect(JSON.stringify(record)).not.toMatch(CANARY_PATTERN);
  });
});
