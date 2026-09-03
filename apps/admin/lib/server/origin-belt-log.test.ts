import { readFileSync } from "node:fs";
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
} from "./origin-belt-log.ts";
// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `apps/api/e2e/support/check-fixture-domain.test.ts` imports its gate.
import { trackedFilesUnder } from "../../../../scripts/tracked-files.mjs";

/**
 * The admin refusal line's own tests (issue #620). `origin-guard.test.ts` covers the
 * other half: that each of the eight belted routes writes exactly one of these and an
 * admitted request writes none. This file covers what the line may contain, and that
 * the set of routes it can name is the set that exists.
 *
 * ## The three things asserted here, and why each is not a code reading
 *
 *   1. **The route set is derived from disk.** `apps/admin/app` is scanned for every
 *      `route.ts` exporting a state-changing handler, its Next path template is
 *      derived, and each derived template must appear in the module's table, and vice
 *      versa. A claim about "every belted route" made against a list written by hand is
 *      a claim about the list.
 *   2. **Every field is a member of a declared vocabulary**, over a corpus of hostile
 *      requests rather than over the friendly ones. SEC-13 is met structurally here: no
 *      field is copied from the request, so the test that proves it is one where the
 *      request is full of values that must not appear, and none does. The corpus is
 *      shaped by what these routes actually carry - a session cookie, an email, a
 *      password field, a TOTP code, a recovery code - because this belt sits in front
 *      of the authentication surface rather than in front of a questionnaire.
 *   3. **The line survives the export allowlist intact**, driven through the real
 *      `allowlistingLogRecordProcessor` rather than by reading its two sets. An event
 *      name outside its vocabulary is rewritten to `application.event` and unlisted
 *      attributes are deleted, so "the line passes SEC-13" is only true if the
 *      processor says so. Both apps emit the same event and the same four field names,
 *      so the allowlist already admitted this line before the admin wrote one - this
 *      asserts that rather than assuming it.
 */

const ADMIN_BASE = "https://admin.qcms.test";

/**
 * Values that must never reach a log line, planted in every request-controlled input
 * the belt can see. Each is distinctive enough that a substring scan over the emitted
 * line is a complete check rather than a suggestive one.
 */
const CANARIES = {
  origin: "https://BELT_ORIGIN_CANARY.example",
  sessionToken: "qcms_admin.session_token=BELT_SESSION_CANARY",
  authorization: "Bearer BELT_BEARER_CANARY",
  fetchSite: "BELT_FETCHSITE_CANARY",
  formId: "BELT_FORMID_CANARY",
  query: "code=BELT_TOTP_CANARY&email=BELT_EMAIL_CANARY",
} as const;

const CANARY_PATTERN = /BELT_[A-Z]+_CANARY/;

function stubAdminEnv(): void {
  vi.stubEnv("QCMS_ADMIN_BASE_URL", ADMIN_BASE);
}

beforeEach(stubAdminEnv);
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

/**
 * Every `route.ts` / `route.tsx` under `dir`, as paths relative to `APP_DIR`.
 *
 * Enumerated through git rather than by walking the directory, so a compiled handler left
 * under `.next-dev` by a dev server is not read as a route (issue #641).
 */
function routeFiles(dir: string, prefix: string): string[] {
  return trackedFilesUnder(dir, { match: /(?:^|\/)route\.tsx?$/ }).map(
    (relative) => `${prefix}${relative}`,
  );
}

/**
 * True for a directory segment Next keeps out of the URL.
 *
 * The admin needs this and the portal did not, which is the whole reason the route
 * table cannot be read off the file tree here: a **route group** `(shell)` exists to
 * share a layout without adding a path segment, and a **parallel-route slot** `@rail`
 * is rendered into a named slot rather than mounted at `/@rail`. Two of the eight belted
 * admin routes sit under the route group (`app/(shell)/settings/...`), and the `@rail`
 * slot carries no route handler today but sits in the same tree the scan walks. A
 * `_folder` is Next's opt-out-of-routing spelling; none exists today, and it is handled
 * here rather than left as the next surprise.
 */
function isUnroutedSegment(segment: string): boolean {
  return (
    (segment.startsWith("(") && segment.endsWith(")")) ||
    segment.startsWith("@") ||
    segment.startsWith("_")
  );
}

/**
 * One path segment as it appears in a URL template: `[formId]` -> `{formId}`,
 * `[...path]` and `[[...path]]` -> `{path}`, anything else unchanged.
 *
 * String operations rather than a bracket-and-dot regex, because the lint gate rejects
 * a quantifier-on-quantifier pattern (`sonarjs/super-linear-regex`) and this shape
 * invites exactly one.
 */
function namedSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) return segment;
  const inner = segment.replaceAll("[", "").replaceAll("]", "");
  return `{${inner.startsWith("...") ? inner.slice(3) : inner}}`;
}

/**
 * The Next path template of a route file, with unrouted segments dropped and dynamic
 * segments named: `(shell)/forms/[formId]/export/route.ts` -> `/forms/{formId}/export`.
 */
function templateOf(relativePath: string): string {
  const segments = relativePath
    .split("/")
    .slice(0, -1)
    .filter((segment) => !isUnroutedSegment(segment))
    .map(namedSegment);
  return `/${segments.join("/")}`;
}

/** A concrete URL of that template's shape, with a canary in every dynamic segment. */
function concreteUrl(template: string): string {
  return `${ADMIN_BASE}${template.replaceAll(/\{\w+}/g, CANARIES.formId)}`;
}

/**
 * Every admin route file that exports a state-changing handler, as a path template.
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
    // Without this, a rename of `app/` turns every assertion below into a vacuous pass
    // over an empty list, which is the failure mode a disk scan invites.
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
    expect(["redirect-with-failure", "redirect-without-message", "refused-403"]).toContain(
      routeOutcome(concreteUrl(template)),
    );
  });

  it.each([
    ["(shell)/settings/password/route.ts", "/settings/password"],
    ["(shell)/@rail/forms/[formId]/links/route.ts", "/forms/{formId}/links"],
    ["_internal/thing/route.ts", "/thing"],
    ["forms/[...path]/route.ts", "/forms/{path}"],
    ["forms/[[...path]]/route.ts", "/forms/{path}"],
    ["sign-out/route.ts", "/sign-out"],
  ])("derives %s as %s", (path, expected) => {
    // The derivation the enumeration above rests on, pinned against shapes the tree
    // does not all contain today. A `templateOf` that quietly stopped stripping route
    // groups would make the enumeration disagree with the table on the two `/settings`
    // routes, which is loud - but one that stopped handling a catch-all would be a
    // single silent wrong template, so both are fixtures rather than notes.
    expect(templateOf(path)).toBe(expected);
  });

  it("does not stretch a template over a path that is merely similar", () => {
    // One bounded segment per parameter: a nested path under the same prefix is a
    // different route and must not be counted as this one.
    expect(classifyRoute(`${ADMIN_BASE}/sign-out/extra`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/two-factor/challenge`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/settings`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/forms/frm_1/export`)).toBe("unrecognized");
  });

  it("survives a URL it cannot parse rather than throwing inside the belt", () => {
    // A throw here would turn a quiet refusal into a 500, which is a behaviour change
    // this work is explicitly not allowed to make.
    expect(classifyRoute("not a url")).toBe("unrecognized");
    expect(routeOutcome("not a url")).toBe("redirect-without-message");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Every field is a member of a declared vocabulary
 * ------------------------------------------------------------------ */

const FETCH_SITE_VOCABULARY = ["absent", "same-origin", "same-site", "cross-site", "none", "other"];
const ORIGIN_VOCABULARY = ["absent", "null", "match", "mismatch", "unverifiable"];
const OUTCOME_VOCABULARY = ["redirect-with-failure", "redirect-without-message"];

/** A request carrying a canary in every input the belt can read. */
function hostileRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${ADMIN_BASE}/two-factor/challenge/verify?${CANARIES.query}`, {
    method: "POST",
    headers: {
      origin: CANARIES.origin,
      cookie: CANARIES.sessionToken,
      authorization: CANARIES.authorization,
      referer: `${ADMIN_BASE}/forms/${CANARIES.formId}`,
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

  it("reads an absent Sec-Fetch-Site as absent", () => {
    expect(classifyFetchSite(new Request(`${ADMIN_BASE}/sign-out`, { method: "POST" }))).toBe(
      "absent",
    );
  });

  it.each([
    [CANARIES.origin, "mismatch"],
    [ADMIN_BASE, "match"],
    ["null", "null"],
  ])("reads Origin %s as %s", (header, expected) => {
    expect(classifyOrigin(hostileRequest({ origin: header }))).toBe(expected);
  });

  it("reads an absent Origin as absent", () => {
    expect(classifyOrigin(new Request(`${ADMIN_BASE}/sign-out`, { method: "POST" }))).toBe(
      "absent",
    );
  });

  it("reports an unverifiable Origin rather than throwing when the base URL is unset", () => {
    // `adminBaseUrl()` throws on a missing variable. A logging helper that propagated
    // that would turn a misconfiguration into a 500 on the refusal path itself, on the
    // sign-in route, which is the worst place in the app to convert a config fault into
    // an outage.
    vi.stubEnv("QCMS_ADMIN_BASE_URL", "");
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
      base: { service: "qcms-admin" },
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
      service: "qcms-admin",
      beltRoute: "/two-factor/challenge/verify",
      beltFetchSite: "absent",
      beltOrigin: "mismatch",
      beltOutcome: "redirect-with-failure",
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
        service: "qcms-admin",
        beltFetchSite: "cross-site",
        beltOrigin: "mismatch",
        beltRoute: "/two-factor/challenge/verify",
        beltOutcome: "redirect-with-failure",
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
      // A field nobody put there, to prove the allowlist is still doing its job on this
      // event rather than having been widened into a pass-through.
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
      beltRoute: "/two-factor/challenge/verify",
      beltFetchSite: "cross-site",
      beltOrigin: "mismatch",
      beltOutcome: "redirect-with-failure",
    });
    expect(JSON.stringify(record)).not.toMatch(CANARY_PATTERN);
  });

  it("drops `service`, so the exported record is told apart by its resource", () => {
    // Worth pinning because the runbook tells an operator to read `service` to know
    // which app refused, and that instruction is only true of stdout. `service` is a
    // logger binding rather than an allowlisted attribute, so on the OTLP side the app
    // is named by the resource's `service.name` (`apps/admin/instrumentation.ts`)
    // instead. An operator told to grep an attribute that is always absent would
    // conclude there were no admin refusals.
    const attributes: Record<string, unknown> = {
      service: "qcms-admin",
      ...originBeltRefusal(hostileRequest()),
    };
    allowlistingLogRecordProcessor().onEmit({
      body: ORIGIN_BELT_REFUSED,
      attributes,
      setBody: () => undefined,
    } as never);
    expect(Object.keys(attributes).sort((a, b) => a.localeCompare(b))).toEqual([
      "beltFetchSite",
      "beltOrigin",
      "beltOutcome",
      "beltRoute",
    ]);
  });
});
