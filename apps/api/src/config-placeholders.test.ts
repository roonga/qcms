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

import { loadConfig } from "./config.js";
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
