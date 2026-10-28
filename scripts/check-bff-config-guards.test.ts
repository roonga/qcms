import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error - plain ESM tooling, deliberately untypechecked.
import { PLACEHOLDER_SHAPES } from "./check-security-hygiene.mjs";
import {
  assertNoPlaceholderSecrets as adminAssert,
  looksLikePlaceholder as adminLooksLikePlaceholder,
  PLACEHOLDER_PREFIXES as ADMIN_PREFIXES,
} from "../apps/admin/lib/server/config.ts";
import {
  assertNoPlaceholderSecrets as portalAssert,
  looksLikePlaceholder as portalLooksLikePlaceholder,
  PLACEHOLDER_PREFIXES as PORTAL_PREFIXES,
} from "../apps/portal/lib/server/config.ts";

/**
 * These cross-app assertions cannot live inside an app: turbo caches a package's suite
 * against that package's own inputs, so a change to the other app would not invalidate it
 * and the gate would report green without re-reading the file that broke it. The tooling
 * project runs from the repository root and outside turbo.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function read(path: string): string {
  return readFileSync(`${REPO_ROOT}${path}`, "utf8");
}

const gateTreatsAsPlaceholder = (value: string): boolean =>
  (PLACEHOLDER_SHAPES as RegExp[]).some((shape) => shape.test(value));

function stemOf(shape: RegExp): string | undefined {
  return /^\^([A-Za-z]+)/.exec(shape.source)?.[1];
}

const TAILS = [
  "",
  "-a-real-value-goes-here-padding-padding",
  "_a_real_value_goes_here_padding_padding",
  "-before-you-deploy-a-real-key",
  "this-now-please-padding-padding-padding",
];

const CANDIDATES: string[] = [
  ...new Set(
    [
      ...(PLACEHOLDER_SHAPES as RegExp[]).flatMap((shape) => {
        const stem = stemOf(shape);
        return stem === undefined ? [] : [`${stem}-`, `${stem}_`, stem];
      }),
      ...PORTAL_PREFIXES.filter((prefix) => /^[A-Za-z]/.test(prefix)),
      ...ADMIN_PREFIXES.filter((prefix) => /^[A-Za-z]/.test(prefix)),
    ].flatMap((head) => TAILS.map((tail) => `${head}${tail}`)),
  ),
].filter((value) => value.trim() !== "");

const REAL_MATERIAL = [
  "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468ace13579bdf02468",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "correct-horse-battery-staple-and-then-some-more",
];

describe("issue #491: the placeholder vocabularies agree across every reader", () => {
  it("built a corpus from every list, so the property is not vacuous", () => {
    expect(CANDIDATES.length).toBeGreaterThan(20);
    expect(CANDIDATES.some((value) => gateTreatsAsPlaceholder(value))).toBe(true);
    expect(CANDIDATES).toContain("replace-before-you-deploy-a-real-key");
  });

  it("the two BFF vocabularies are identical, not merely similar", () => {
    expect([...PORTAL_PREFIXES]).toEqual([...ADMIN_PREFIXES]);
  });

  it.each([
    ["portal", portalLooksLikePlaceholder],
    ["admin", adminLooksLikePlaceholder],
  ])("%s refuses every value the repository gate accepts as a placeholder", (_app, detects) => {
    const leaks = CANDIDATES.filter((value) => gateTreatsAsPlaceholder(value) && !detects(value));
    expect(
      leaks,
      "these values pass the committed-file gate as placeholders AND would boot a BFF, which is how a published token reaches a running deployment",
    ).toEqual([]);
  });

  it.each([
    ["portal", portalLooksLikePlaceholder],
    ["admin", adminLooksLikePlaceholder],
  ])("%s calls no real material a placeholder", (_app, detects) => {
    expect(REAL_MATERIAL.filter((value) => detects(value))).toEqual([]);
  });

  it.each([
    ["portal", portalAssert],
    ["admin", adminAssert],
  ])(
    "%s refuses to boot on the shipped internal-token placeholder",
    (_app, assertNoPlaceholders) => {
      const previous = process.env.QCMS_INTERNAL_TOKEN;
      process.env.QCMS_INTERNAL_TOKEN = "replace-with-a-random-32-character-internal-token";
      try {
        expect(() => assertNoPlaceholders()).toThrow(/QCMS_INTERNAL_TOKEN/);
      } finally {
        if (previous === undefined) delete process.env.QCMS_INTERNAL_TOKEN;
        else process.env.QCMS_INTERNAL_TOKEN = previous;
      }
    },
  );
});

/**
 * The API reads `QCMS_ADMIN_SECURE_COOKIES` with no loopback guard and relies on the admin
 * BFF refusing to boot instead. A source scan rather than a behavioural test, because what
 * must not silently change is that the call is there.
 */
describe("issue #402: the guards the API's unguarded cookie read depends on", () => {
  const APPS = [
    {
      name: "portal",
      config: "apps/portal/lib/server/config.ts",
      boot: "apps/portal/instrumentation.ts",
    },
    {
      name: "admin",
      config: "apps/admin/lib/server/config.ts",
      boot: "apps/admin/instrumentation.ts",
    },
  ];

  it.each(APPS)("$name defines the cookie-security boot refusal", ({ config }) => {
    expect(read(config)).toContain("export function assertSecureCookiesConfigured(");
  });

  it.each(APPS)("$name defines the placeholder-secret boot refusal", ({ config }) => {
    expect(read(config)).toContain("export function assertNoPlaceholderSecrets(");
  });

  it.each(APPS)("$name calls both refusals from its boot hook", ({ boot }) => {
    const source = read(boot);
    expect(source).toContain("assertSecureCookiesConfigured()");
    expect(source).toContain("assertNoPlaceholderSecrets()");
    // A guard defined and never called is what a source scan has to catch, so asserting
    // the export alone is not enough.
    expect(source).toMatch(/export function register\(\)[\s\S]*refuseUnsafeConfiguration\(\)/);
  });

  it("the admin refusal still keys on the variable the API reads unguarded", () => {
    // Were these to diverge, the API's recorded reliance would no longer be about the same
    // knob and the note beside its read would have gone stale.
    expect(read("apps/admin/lib/server/config.ts")).toContain("QCMS_ADMIN_SECURE_COOKIES");
    expect(read("apps/api/src/config.ts")).toContain("QCMS_ADMIN_SECURE_COOKIES");
  });

  it("the API records the reliance beside the read, rather than leaving it silent", () => {
    // The exemption must stay visible at the site of the read, so this pins the comment
    // in `apps/api/src/config.ts` that records it. Removing that comment fails here.
    expect(read("apps/api/src/config.ts")).toContain("issue #402");
  });
});
