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
 * Boot-time configuration guards that span the API and both BFFs (issues #402 and #491).
 *
 * ## Why one file, and why it is here rather than inside an app
 *
 * Both invariants below are of the shape "a control present in one app and absent in its
 * twin, with a document asserting it of both". That is the defect class task 040 kept
 * finding (#470, #401, #402, #471, #487), and the durable answer #487 arrived at is a
 * repo-level derived check rather than a comment asking an author to remember a twin.
 *
 * It cannot live in `apps/api` or in either app, for a reason `scripts/check-origin-guards.test.ts`
 * records at length: a cross-app assertion inside one package's Vitest project is cached by
 * turbo against that package's own inputs, so a change to the *other* app would not
 * invalidate it and the gate would report green having never re-read the file that broke
 * it. The `tooling` project runs from the repo root and outside turbo (`pnpm test` is
 * `turbo run test && pnpm test:tooling`), so it always sees the tree as it is.
 *
 * The cost is that `scripts/` is neither linted nor typechecked, which is the recorded
 * repo-wide state of that project (`vitest.config.ts`, issue #257). That is a pre-existing
 * gap this file sits inside, not a new one it opens.
 *
 * ## How the three-way agreement is established without importing the API
 *
 * The property wanted is that the API's placeholder vocabulary, the portal's, the admin's
 * and the committed-file gate's all accept the same spellings. It is established in two
 * halves rather than one, deliberately:
 *
 *   - **API against the gate** is already pinned, bidirectionally and over a corpus derived
 *     from both lists, by `apps/api/src/config-placeholders.test.ts`. That test was extended
 *     rather than copied, per issue #491, and it stays the home of that pair.
 *   - **Each BFF against the gate** is pinned here, over the same corpus construction.
 *
 * The gate (`scripts/check-security-hygiene.mjs`) is the shared vertex, so agreement with it
 * on both sides is agreement across all four readers. Importing `apps/api/src/config.ts` here
 * would have made the assertion direct and would also have pulled `@qcms/db` and
 * `@qcms/a2ui-compiler` into a project that runs outside turbo's build ordering, which is a
 * fragility bought for no extra coverage.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function read(path: string): string {
  return readFileSync(`${REPO_ROOT}${path}`, "utf8");
}

const gateTreatsAsPlaceholder = (value: string): boolean =>
  (PLACEHOLDER_SHAPES as RegExp[]).some((shape) => shape.test(value));

/** The leading literal word of a gate shape, e.g. `/^replace[-_]/i` -> "replace". */
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

/**
 * Every candidate any of the vocabularies can produce: each gate stem and each BFF prefix,
 * crossed with separator and suffix variants. Derived rather than hand-written, which is
 * what makes it survive a change to either side - the exact string the 040 review found
 * (`replace-before-you-deploy-a-real-key`) is reached by construction here, not by being
 * written down.
 */
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

/** Values that are unmistakably real: no reader may call any of these a placeholder. */
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
  ])("%s refuses to boot on the shipped internal-token placeholder", (_app, assertNoPlaceholders) => {
    const previous = process.env.QCMS_INTERNAL_TOKEN;
    process.env.QCMS_INTERNAL_TOKEN = "replace-with-a-random-32-character-internal-token";
    try {
      expect(() => assertNoPlaceholders()).toThrow(/QCMS_INTERNAL_TOKEN/);
    } finally {
      if (previous === undefined) delete process.env.QCMS_INTERNAL_TOKEN;
      else process.env.QCMS_INTERNAL_TOKEN = previous;
    }
  });
});

/**
 * The topology the API depends on instead of guarding `QCMS_ADMIN_SECURE_COOKIES` itself
 * (issue #402).
 *
 * `apps/api/src/config.ts` reads that variable with no loopback guard and says, in a comment
 * beside the read, that it relies on the admin BFF refusing to boot in the configuration
 * where it would matter. Two legs of that reliance are properties of the API's own route tree
 * and are asserted in `apps/api/src/features/auth/auth-mount.test.ts`. Two are not, and are
 * asserted here because they live in other trees:
 *
 *   1. The admin still refuses to boot on a downgraded off-loopback cookie configuration.
 *   2. The API container is still unreachable from a browser. That one is already pinned by
 *      `scripts/compose-config.test.ts` ("publishes portal and admin, and nothing else", and
 *      the same claim re-checked with the Caddy and dev-tools overlays layered on), so it is
 *      named here rather than duplicated.
 *
 * A source scan rather than a behavioural test, and for the same reason
 * `check-origin-guards.test.ts` scans: what must not silently change is that the call is
 * **there**. Each app's own suite already asserts what the call does.
 */
describe("issue #402: the guards the API's unguarded cookie read depends on", () => {
  const APPS = [
    { name: "portal", config: "apps/portal/lib/server/config.ts", boot: "apps/portal/instrumentation.ts" },
    { name: "admin", config: "apps/admin/lib/server/config.ts", boot: "apps/admin/instrumentation.ts" },
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
    // Called from `register()`, which Next runs once per server process before anything
    // serves. A guard defined and never called is the failure mode a source scan exists to
    // catch, so the export test above is not enough on its own.
    expect(source).toMatch(/export function register\(\)[\s\S]*refuseUnsafeConfiguration\(\)/);
  });

  it("the admin refusal still keys on the variable the API reads unguarded", () => {
    // If this stops being the same variable, the API's recorded reliance is no longer about
    // the same knob and the comment beside its read has gone stale.
    expect(read("apps/admin/lib/server/config.ts")).toContain("QCMS_ADMIN_SECURE_COOKIES");
    expect(read("apps/api/src/config.ts")).toContain("QCMS_ADMIN_SECURE_COOKIES");
  });

  it("the API records the reliance beside the read, rather than leaving it silent", () => {
    // The acceptance criterion of #402: the exemption must be visible at the site of the
    // read. A future edit that deletes the comment and leaves the read unguarded is exactly
    // the state the issue was filed about.
    expect(read("apps/api/src/config.ts")).toContain("issue #402");
  });
});
