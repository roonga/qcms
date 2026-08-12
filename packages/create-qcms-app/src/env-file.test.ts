import { describe, expect, it } from "vitest";

import { fillEnv, generateSecret } from "./env-file.js";

/**
 * A fixture in the exact shape the generator emits: prose, a marker line carrying the
 * attributes, then the assignment. Every assertion below depends on that shape, so
 * each test states which line it is exercising before it asserts the outcome.
 */
const EXAMPLE = [
  "# Signing keys, at least 32 characters each.",
  "# (required, secret)",
  "QCMS_LINK_KEYS=",
  "",
  "# Public origin of the respondent portal.",
  "# (required)",
  "QCMS_PORTAL_BASE_URL=",
  "",
  "# Admin TOTP policy.",
  "# (optional, default required)",
  "# QCMS_ADMIN_2FA=",
  "",
  "# Caddy's ACME contact address.",
  "# (conditional)",
  "# QCMS_ACME_EMAIL=",
  "",
].join("\n");

const STUB = (): string => "GENERATED";

describe("fillEnv", () => {
  it("generates a value for a mandatory secret nobody answered", () => {
    expect(EXAMPLE).toContain("# (required, secret)\nQCMS_LINK_KEYS=");
    const { text } = fillEnv(EXAMPLE, {}, STUB);
    expect(text).toContain("QCMS_LINK_KEYS=GENERATED");
  });

  it("uses the operator's answer in preference to generating one", () => {
    const { text } = fillEnv(EXAMPLE, { QCMS_LINK_KEYS: "chosen" }, STUB);
    expect(text).toContain("QCMS_LINK_KEYS=chosen");
    expect(text).not.toContain("GENERATED");
  });

  it("reports a mandatory non-secret nobody answered rather than inventing one", () => {
    expect(EXAMPLE).toContain("# (required)\nQCMS_PORTAL_BASE_URL=");
    const { text, unresolved } = fillEnv(EXAMPLE, {}, STUB);
    expect(unresolved).toStrictEqual(["QCMS_PORTAL_BASE_URL"]);
    expect(text).toContain("\nQCMS_PORTAL_BASE_URL=\n");
  });

  it("uncomments an optional variable the operator answered", () => {
    expect(EXAMPLE).toContain("# QCMS_ADMIN_2FA=");
    const { text } = fillEnv(EXAMPLE, { QCMS_ADMIN_2FA: "optional" }, STUB);
    expect(text).toContain("\nQCMS_ADMIN_2FA=optional\n");
    expect(text).not.toContain("# QCMS_ADMIN_2FA=");
  });

  it("leaves an unanswered optional commented out, and off the unresolved list", () => {
    const { text, unresolved } = fillEnv(EXAMPLE, {}, STUB);
    expect(text).toContain("# QCMS_ACME_EMAIL=");
    expect(unresolved).not.toContain("QCMS_ACME_EMAIL");
  });

  it("never generates a value for a commented-out secret", () => {
    const commented = "# (required, secret)\n# QCMS_APP_KEY=\n";
    const { text } = fillEnv(commented, {}, STUB);
    expect(text).toContain("# QCMS_APP_KEY=");
    expect(text).not.toContain("GENERATED");
  });

  it("leaves prose and blank lines byte-identical", () => {
    const { text } = fillEnv(EXAMPLE, {}, STUB);
    expect(text.split("\n").filter((line) => line.startsWith("# Signing"))).toStrictEqual([
      "# Signing keys, at least 32 characters each.",
    ]);
  });
});

describe("generateSecret", () => {
  it("clears every `at least 32 characters` floor in the schema", () => {
    expect(generateSecret().length).toBeGreaterThanOrEqual(32);
  });

  it("is URL-safe, so it survives a .env line and a shell without quoting", () => {
    expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat", () => {
    const values = new Set(Array.from({ length: 64 }, () => generateSecret()));
    expect(values.size).toBe(64);
  });
});
