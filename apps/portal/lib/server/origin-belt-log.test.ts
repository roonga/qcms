import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createJsonLogger } from "@qcms/observability/logger";
import { allowlistingLogRecordProcessor, safeEventName } from "@qcms/observability/logs";
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

/**
 * The refusal line's own tests (issue #578). `origin-guard.test.ts` covers the other
 * half: that each belted route writes exactly one of these and an admitted request
 * writes none. This file covers what the line may contain, and that the set of routes
 * it can name is the set that exists.
 *
 * ## The three things asserted here, and why each is not a code reading
 *
 *   1. **The route set is derived from disk.** `apps/portal/app` is scanned for every
 *      `route.ts` exporting a state-changing handler, and each derived template must
 *      appear in the module's table, and vice versa. A claim about "every belted
 *      route" made against a list written by hand is a claim about the list.
 *   2. **Every field is a member of a declared vocabulary**, over a corpus of hostile
 *      requests rather than over the friendly ones. SEC-13 is met structurally here:
 *      no field is copied from the request, so the test that proves it is one where
 *      the request is full of values that must not appear, and none does.
 *   3. **The line survives the export allowlist intact**, driven through the real
 *      `allowlistingLogRecordProcessor` rather than by reading its two sets. An event
 *      name outside its vocabulary is rewritten to `application.event` and unlisted
 *      attributes are deleted, so "the line passes SEC-13" is only true if the
 *      processor says so.
 */

const PORTAL_BASE = "https://forms.qcms.test";

/**
 * Values that must never reach a log line, planted in every request-controlled input
 * the belt can see. Each is distinctive enough that a substring scan over the emitted
 * line is a complete check rather than a suggestive one.
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

/** Verbs whose handlers change state, so the belt applies to them. */
const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A named top-level exported handler, `async` or not. */
const EXPORTED_HANDLER = /^export (?:async )?function (\w+)\s*\(/m;

/** Every `route.ts` / `route.tsx` under `dir`, as paths relative to `APP_DIR`. */
function routeFiles(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...routeFiles(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
      continue;
    }
    if (/^route\.tsx?$/.test(entry.name)) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

/** The Next path template of a route file: `f/[formSlug]/start/route.ts` -> `/f/{formSlug}/start`. */
function templateOf(relativePath: string): string {
  const segments = relativePath.split("/").slice(0, -1);
  return `/${segments.map((s) => s.replace(/^\[(.+)]$/, "{$1}")).join("/")}`;
}

/** A concrete URL of that template's shape, with a canary in every dynamic segment. */
function concreteUrl(template: string): string {
  return `${PORTAL_BASE}${template.replaceAll(/\{\w+}/g, CANARIES.slug)}`;
}

/**
 * Every portal route file that exports a state-changing handler, as a path template.
 *
 * This is the enumeration. It reads the tree rather than a list, so a belted route
 * added tomorrow appears here without anyone remembering this file exists.
 */
const MUTATING_ROUTE_TEMPLATES: string[] = routeFiles(APP_DIR, "")
  .filter((relative) => {
    const source = readFileSync(`${APP_DIR}/${relative}`, "utf8");
    return source
      .split("\n")
      .some((line) => MUTATING_VERBS.has(EXPORTED_HANDLER.exec(line)?.[1] ?? ""));
  })
  .map(templateOf)
  .sort((a, b) => a.localeCompare(b));

describe("the belted route set is the one on disk", () => {
  it("finds state-changing route handlers to enumerate", () => {
    // Without this, a rename of `app/` turns every assertion below into a vacuous
    // pass over an empty list, which is the failure mode a disk scan invites.
    expect(MUTATING_ROUTE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("recognises every state-changing route in the tree, and only those", () => {
    // Both directions in one assertion: a route added without a table entry fails on
    // the left, a table entry whose route was deleted fails on the right.
    expect(MUTATING_ROUTE_TEMPLATES).toEqual(
      [...BELTED_ROUTE_TEMPLATES].sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each(MUTATING_ROUTE_TEMPLATES)("classifies a request to %s as that template", (template) => {
    expect(classifyRoute(concreteUrl(template))).toBe(template);
  });

  it.each(MUTATING_ROUTE_TEMPLATES)("names an outcome for %s", (template) => {
    expect(["redirect-to-entry", "redirect-to-step", "forbidden"]).toContain(
      routeOutcome(concreteUrl(template)),
    );
  });

  it("does not stretch a template over a path that is merely similar", () => {
    // One bounded segment per parameter: a nested path under the same prefix is a
    // different route and must not be counted as this one.
    expect(classifyRoute(`${PORTAL_BASE}/s/ses_1/step/extra`)).toBe("unrecognized");
    expect(classifyRoute(`${PORTAL_BASE}/s/ses_1`)).toBe("unrecognized");
    expect(classifyRoute(`${PORTAL_BASE}/l/lnk_1`)).toBe("unrecognized");
  });

  it("survives a URL it cannot parse rather than throwing inside the belt", () => {
    // A throw here would turn a quiet refusal into a 500, which is a behaviour change
    // this work is explicitly not allowed to make.
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
    // `portalBaseUrl()` throws on a missing variable. A logging helper that propagated
    // that would turn a misconfiguration into a 500 on the refusal path itself.
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
    expect(classifyOrigin(hostileRequest())).toBe("unverifiable");
  });

  it("emits only vocabulary members, whatever the request carries", () => {
    for (const fetchSite of ["cross-site", CANARIES.fetchSite, ""]) {
      const fields = originBeltRefusal(hostileRequest({ "sec-fetch-site": fetchSite }));
      expect(FETCH_SITE_VOCABULARY).toContain(fields.beltFetchSite);
      expect(ORIGIN_VOCABULARY).toContain(fields.beltOrigin);
      expect(BELTED_ROUTE_TEMPLATES).toContain(fields.beltRoute);
      expect(["redirect-to-entry", "redirect-to-step", "forbidden"]).toContain(fields.beltOutcome);
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
    // The whole serialized line, not the fields: a value smuggled into a key, a nested
    // object or the message itself would be missed by a field-by-field check.
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
    // `logOriginBeltRefusal` is what the belt calls. Asserting only `originBeltRefusal`
    // would leave the production path (level, message, sink) unpinned.
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
    // Not in the allowlist's vocabulary, this becomes `application.event` and an
    // adopter's backend cannot count refusals at all.
    expect(safeEventName(ORIGIN_BELT_REFUSED)).toBe(ORIGIN_BELT_REFUSED);
  });

  it("keeps the four fields and deletes anything else on the same record", () => {
    const attributes: Record<string, unknown> = {
      ...originBeltRefusal(hostileRequest({ "sec-fetch-site": "cross-site" })),
      // A field nobody put there, to prove the allowlist is still doing its job on
      // this event rather than having been widened into a pass-through.
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
