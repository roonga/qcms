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
} from "./origin-belt-log.ts";

import { trackedFilesUnder } from "../../../../scripts/tracked-files.mjs";

const ADMIN_BASE = "https://admin.qcms.test";

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

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const EXPORTED_HANDLER = /^export (?:async )?function (\w+)\s*\(/m;

function routeFiles(dir: string, prefix: string): string[] {
  return trackedFilesUnder(dir, { match: /(?:^|\/)route\.tsx?$/ }).map(
    (relative) => `${prefix}${relative}`,
  );
}

function isUnroutedSegment(segment: string): boolean {
  return (
    (segment.startsWith("(") && segment.endsWith(")")) ||
    segment.startsWith("@") ||
    segment.startsWith("_")
  );
}

function namedSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) return segment;
  const inner = segment.replaceAll("[", "").replaceAll("]", "");
  return `{${inner.startsWith("...") ? inner.slice(3) : inner}}`;
}

function templateOf(relativePath: string): string {
  const segments = relativePath
    .split("/")
    .slice(0, -1)
    .filter((segment) => !isUnroutedSegment(segment))
    .map(namedSegment);
  return `/${segments.join("/")}`;
}

function concreteUrl(template: string): string {
  return `${ADMIN_BASE}${template.replaceAll(/\{\w+}/g, CANARIES.formId)}`;
}

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
    expect(templateOf(path)).toBe(expected);
  });

  it("does not stretch a template over a path that is merely similar", () => {
    expect(classifyRoute(`${ADMIN_BASE}/sign-out/extra`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/two-factor/challenge`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/settings`)).toBe("unrecognized");
    expect(classifyRoute(`${ADMIN_BASE}/forms/frm_1/export`)).toBe("unrecognized");
  });

  it("survives a URL it cannot parse rather than throwing inside the belt", () => {
    expect(classifyRoute("not a url")).toBe("unrecognized");
    expect(routeOutcome("not a url")).toBe("redirect-without-message");
  });
});

const FETCH_SITE_VOCABULARY = ["absent", "same-origin", "same-site", "cross-site", "none", "other"];
const ORIGIN_VOCABULARY = ["absent", "null", "match", "mismatch", "unverifiable"];
const OUTCOME_VOCABULARY = ["redirect-with-failure", "redirect-without-message"];

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
      beltRoute: "/two-factor/challenge/verify",
      beltFetchSite: "cross-site",
      beltOrigin: "mismatch",
      beltOutcome: "redirect-with-failure",
    });
    expect(JSON.stringify(record)).not.toMatch(CANARY_PATTERN);
  });

  it("drops `service`, so the exported record is told apart by its resource", () => {
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
