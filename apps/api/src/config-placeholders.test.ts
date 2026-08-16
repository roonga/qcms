/**
 * SEC-8: "a deployment with placeholder secrets must refuse to boot" (task 040).
 *
 * The sentence is in `docs/SECURITY_DESIGN.md` §6 and, until this test existed,
 * nothing enforced it: validation was a length floor, and every placeholder the
 * repo ships is comfortably longer than the floor. The fixtures below are the
 * **literal values** from the committed example files rather than invented
 * strings, so the test fails the moment the guard stops covering what an
 * operator would actually copy.
 */

import { describe, expect, it } from "vitest";

// The committed-secret half of the same control. Imported so the agreement
// between the two lists is asserted rather than eyeballed (task 040 review).
// @ts-expect-error - plain ESM tooling, deliberately untypechecked.
import { PLACEHOLDER_SHAPES } from "../../../scripts/check-security-hygiene.mjs";
import { loadConfig, PLACEHOLDER_PREFIXES } from "./config.js";
import { validEnv } from "./test-support.js";

/** Verbatim from `.env.compose.example` (lines 7-9, 29, 52) and the app examples. */
const SHIPPED_PLACEHOLDERS = {
  QCMS_LINK_KEYS: "replace-with-a-random-32-character-link-signing-key",
  QCMS_SESSION_KEYS: "replace-with-a-random-32-character-session-signing-key",
  QCMS_INTERNAL_TOKEN: "replace-with-a-random-32-character-internal-token",
  QCMS_APP_KEY: "replace-with-a-random-32-character-app-encryption-key",
  QCMS_ADMIN_AUTH_SECRET: "replace-with-a-random-32-character-admin-auth-secret",
} as const;

function loadWith(overrides: Record<string, string>): { ok: boolean; message: string } {
  try {
    loadConfig(validEnv(overrides));
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

describe("placeholder secrets refuse to boot (SEC-8)", () => {
  it("accepts the generated secrets the test harness produces (the fixture is real)", () => {
    // Without this, every assertion below could be passing for an unrelated reason.
    expect(loadWith({}).ok).toBe(true);
  });

  it("every placeholder in the shipped example files is long enough to pass the length floor", () => {
    for (const value of Object.values(SHIPPED_PLACEHOLDERS)) {
      expect(value.length).toBeGreaterThanOrEqual(32);
    }
  });

  it.each(Object.entries(SHIPPED_PLACEHOLDERS))(
    "refuses %s at its example value",
    (name, value) => {
      const result = loadWith({ [name]: value });
      expect(result.ok).toBe(false);
      expect(result.message).toContain(name);
      expect(result.message).toContain("placeholder");
    },
  );

  it("refuses a placeholder hiding among real keys in a rotation list", () => {
    const real = validEnv({}).QCMS_SESSION_KEYS ?? "";
    const result = loadWith({
      QCMS_SESSION_KEYS: `${real},${SHIPPED_PLACEHOLDERS.QCMS_SESSION_KEYS}`,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("QCMS_SESSION_KEYS");
  });

  it("refuses a placeholder in a versioned admin auth secret list", () => {
    const result = loadWith({
      QCMS_ADMIN_AUTH_SECRETS: `2:${SHIPPED_PLACEHOLDERS.QCMS_ADMIN_AUTH_SECRET}`,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("QCMS_ADMIN_AUTH_SECRETS");
  });

  it.each(["change-me-change-me-change-me-change-me", "<generate a 32 character secret here>"])(
    "refuses the other conventional placeholder spellings: %s",
    (value) => {
      expect(loadWith({ QCMS_APP_KEY: value }).ok).toBe(false);
    },
  );

  it("never echoes the refused value, only the variable name (SEC-8)", () => {
    const result = loadWith(SHIPPED_PLACEHOLDERS);
    expect(result.ok).toBe(false);
    for (const value of Object.values(SHIPPED_PLACEHOLDERS)) {
      expect(result.message).not.toContain(value);
    }
  });
});

describe("the boot guard and the repository gate agree on what a placeholder is", () => {
  /**
   * Spellings a human might plausibly write in an example file, plus values that
   * are unmistakably real. The property is agreement, in both directions: a
   * value the gate waves through as "obviously a placeholder, safe to commit"
   * must be a value the API refuses to boot on, or a published key reaches a
   * running deployment through the gap between them.
   */
  const CANDIDATES = [
    "replace-with-a-random-32-character-app-encryption-key",
    "replace_with_a_random_32_character_app_encryption_key",
    "replace-me-before-you-deploy-this-thing",
    "replace_me_before_you_deploy_this_thing",
    "change-me-change-me-change-me-change-me",
    "change_me_change_me_change_me_change_me",
    "changeme-changeme-changeme-changeme-abc",
    "your-secret-goes-right-here-please-yes",
    "your_secret_goes_right_here_please_yes",
    "example-value-not-for-production-use-x",
    "example_value_not_for_production_use_x",
    "placeholder-value-not-for-production-x",
    "<generate a 32 character secret here>",
    // Real-looking material: neither side may treat these as placeholders.
    "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468ace13579bdf02468",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "correct-horse-battery-staple-and-then-some-more",
  ];

  const gateTreatsAsPlaceholder = (value: string): boolean =>
    (PLACEHOLDER_SHAPES as RegExp[]).some((shape) => shape.test(value));

  it.each(CANDIDATES)("agrees about %s", (value) => {
    const bootRefuses = !loadWith({ QCMS_APP_KEY: value }).ok;
    expect(bootRefuses, `boot guard and repository gate disagree about "${value}"`).toBe(
      gateTreatsAsPlaceholder(value),
    );
  });

  it("covers both verdicts, so the agreement is not vacuous", () => {
    const verdicts = CANDIDATES.map((value) => gateTreatsAsPlaceholder(value));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe("the remedy is correct for the kind of knob, not just for secrets", () => {
  it("still refuses a placeholder DATABASE_URL (the rejection is not scoped away)", () => {
    const result = loadWith({ DATABASE_URL: "replace-with-your-postgres-connection-string" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("DATABASE_URL");
    expect(result.message).toContain("placeholder");
  });

  it("does not tell an operator to generate a secret for a connection string", () => {
    // The defect this pins: `parseRequiredString` serves two secrets and
    // DATABASE_URL, so a single remedy sentence sent operators of a
    // placeholder-shaped URL to the secret-generation runbook.
    const result = loadWith({ DATABASE_URL: "replace-with-your-postgres-connection-string" });
    expect(result.message).not.toContain("generate real secrets");
    expect(result.message).toContain("set the value for this deployment");
  });

  it("still gives secrets the secret-generation remedy", () => {
    const result = loadWith({ QCMS_APP_KEY: SHIPPED_PLACEHOLDERS.QCMS_APP_KEY });
    expect(result.message).toContain("generate real secrets");
    expect(result.message).toContain("docs/operations.md");
  });
});

describe("safety property: anything the repository gate calls a placeholder must not boot", () => {
  /**
   * The invariant, stated directionally because that is the direction that
   * protects a deployment: **if `check-security-hygiene.mjs` waves a value
   * through as an obvious placeholder, `loadConfig` must refuse to boot on it.**
   * The converse is deliberately not asserted - the boot guard is allowed to be
   * stricter than the committed-file gate, and an empty value is refused by a
   * different rule ("is required") rather than as a placeholder.
   *
   * Derived from **both** constants rather than from hand-picked strings, which
   * is what makes it survive a change to either. The previous test was 16
   * literal candidates and structurally could not see the gap the PO review
   * found: the gate accepted `/^replace[-_]/i` while the boot guard listed only
   * `replace-with`, `replace-me` and `replace-this`, so
   * `replace-before-you-deploy-a-real-key` passed the scan and booted.
   */

  /** The leading literal word of a gate shape, e.g. `/^replace[-_]/i` -> "replace". */
  function stemOf(shape: RegExp): string | undefined {
    const literal = /^\^([A-Za-z]+)/.exec(shape.source);
    return literal?.[1];
  }

  const TAILS = [
    "",
    "-a-real-value-goes-here-padding-padding",
    "_a_real_value_goes_here_padding_padding",
    "-before-you-deploy-a-real-key",
    "this-now-please-padding-padding-padding",
  ];

  /**
   * Every candidate either side's vocabulary can produce: each gate stem and
   * each boot-guard prefix, crossed with separator and suffix variants.
   */
  const CANDIDATES: string[] = [
    ...new Set(
      [
        ...(PLACEHOLDER_SHAPES as RegExp[]).flatMap((shape) => {
          const stem = stemOf(shape);
          return stem === undefined ? [] : [`${stem}-`, `${stem}_`, stem];
        }),
        ...PLACEHOLDER_PREFIXES.filter((prefix) => /^[A-Za-z]/.test(prefix)),
      ].flatMap((head) => TAILS.map((tail) => `${head}${tail}`)),
    ),
  ].filter((value) => value.trim() !== "");

  const gateTreatsAsPlaceholder = (value: string): boolean =>
    (PLACEHOLDER_SHAPES as RegExp[]).some((shape) => shape.test(value));

  it("built a corpus from both lists, so the property is not vacuous", () => {
    expect(CANDIDATES.length).toBeGreaterThan(20);
    expect(CANDIDATES.some((value) => gateTreatsAsPlaceholder(value))).toBe(true);
    // The exact string the PO review found, reached by construction rather than
    // by being written down: gate stem "replace" + a tail.
    expect(CANDIDATES).toContain("replace-before-you-deploy-a-real-key");
  });

  it("refuses to boot on every value the repository gate accepts as a placeholder", () => {
    const leaks = CANDIDATES.filter(
      (value) => gateTreatsAsPlaceholder(value) && loadWith({ QCMS_APP_KEY: value }).ok,
    );
    expect(
      leaks,
      "these values pass the committed-file gate as placeholders AND boot, which is how a published key reaches a running deployment",
    ).toEqual([]);
  });

  it("holds for the key lists and the versioned admin secret too, not just one knob", () => {
    const probe = "replace-before-you-deploy-a-real-key-padding";
    expect(gateTreatsAsPlaceholder(probe)).toBe(true);
    for (const name of ["QCMS_LINK_KEYS", "QCMS_SESSION_KEYS", "QCMS_INTERNAL_TOKEN"]) {
      expect(loadWith({ [name]: probe }).ok, `${name} booted on a gate-accepted placeholder`).toBe(
        false,
      );
    }
  });
});
