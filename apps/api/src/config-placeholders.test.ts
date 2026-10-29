// The BFF half of this agreement is asserted from the repo root, in
// `scripts/check-bff-config-guards.test.ts`: a cross-app assertion here would be
// turbo-cached against this package's inputs and report green without reading it.

import { describe, expect, it } from "vitest";

// @ts-expect-error - plain ESM tooling, deliberately untypechecked.
import { PLACEHOLDER_SHAPES } from "../../../scripts/check-security-hygiene.mjs";
import { loadConfig, PLACEHOLDER_PREFIXES } from "./config.js";
import { validEnv } from "./test-support.js";

/** Must stay verbatim from the shipped example env files, not invented strings. */
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
  // One direction only: the boot guard is allowed to be stricter than the gate.

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
