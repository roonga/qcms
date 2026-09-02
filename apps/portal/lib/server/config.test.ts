import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertNoPlaceholderSecrets,
  assertSecureCookiesConfigured,
  looksLikePlaceholder,
  portalBaseUrl,
  secureCookies,
} from "./config.js";

/**
 * The server-only BFF configuration readers (task 029, extended for the Compose
 * topology in task 036).
 *
 * `portalBaseUrl()` is required rather than defaulted on purpose: the Start route
 * builds its 303 redirect from it, so an unset value must fail loudly at the first
 * request instead of silently emitting the container-internal origin a respondent's
 * browser cannot follow. That makes "who passes this variable" a real contract, and
 * every process that serves the portal (Compose, the Playwright harness, and
 * `scripts/dev-portal.mjs`) has to honour it.
 *
 * `vi.stubEnv` rather than assignment: `NODE_ENV` is typed read-only by Next's
 * ambient types, and stubbing restores every variable in one call whichever way a
 * case ends.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("portalBaseUrl", () => {
  it("returns the configured origin unchanged", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("trims trailing slashes so a path can always be appended", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test///");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("throws a message naming the variable when it is unset or empty", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
  });
});

describe("secureCookies", () => {
  it('honours QCMS_SECURE_COOKIES="true" whatever NODE_ENV says', () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);
  });

  it('honours QCMS_SECURE_COOKIES="false" whatever NODE_ENV says', () => {
    // The documented localhost Compose profile: a plain-HTTP stack browsed at an
    // origin the browser does not trust could create a session and then fail to
    // resume it after Start. `assertSecureCookiesConfigured` below is what keeps
    // that exception confined to loopback.
    vi.stubEnv("QCMS_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset or blank", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);

    vi.stubEnv("QCMS_SECURE_COOKIES", "  ");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
  });

  /**
   * Issue #401, and a deliberate replacement for the case that used to sit here.
   *
   * That case pinned the opposite rule: `yes` was "an unrecognized override value"
   * the reader ignored in favour of `NODE_ENV`. It is rewritten rather than deleted,
   * because the lenient behaviour it described was real and was ruled away rather
   * than found broken (Code Owner, 2026-09-02) - the portal now adopts the same
   * `boolEnv`/`parseBool` contract the admin and the API already use. The silent
   * fallback was a configuration that looks set and is not, and it also slipped past
   * the off-loopback refusal below, which fires on the effective value.
   */
  it("accepts the API's boolean spellings, so the three processes cannot disagree", () => {
    // NODE_ENV is stubbed to the opposite of the expected answer in each loop, so a
    // case that fell back to it instead of parsing the value goes red rather than
    // passing for the wrong reason.
    vi.stubEnv("NODE_ENV", "development");
    for (const raw of ["on", "1", "yes", "TRUE", " true "]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(true);
    }
    vi.stubEnv("NODE_ENV", "production");
    for (const raw of ["off", "0", "no", "FALSE", " false "]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(false);
    }
  });

  it("refuses a value that is not a boolean at all, naming the variable", () => {
    // The other direction of the same ruling: unparseable is a loud boot failure now,
    // not a silent fall-through to NODE_ENV.
    vi.stubEnv("NODE_ENV", "production");
    for (const raw of ["maybe", "banana", "2"]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(() => secureCookies()).toThrow(/QCMS_SECURE_COOKIES/);
    }
  });
});

/**
 * The boot-time refusal (issue #292 point 1).
 *
 * **The admin's `config.test.ts` covers the same decision**, because the two apps
 * disagreeing about exactly this is what the issue was filed about. Nothing computes that
 * the two case lists match, though, and they had already drifted when someone looked
 * (issue #412): the admin carried the raw `0`/`no`/`off` cases and this file did not,
 * which is the gap behind issue #409. Both sides carry them now that issue #401 gave the
 * two readers one parser, but nothing computes that either. A case added here and not
 * there goes unnoticed, so adding one means opening the other file, not trusting a gate.
 *
 * The positive controls come first on purpose: a red then distinguishes "the refusal
 * broke" from "the fixture was never a configuration that boots".
 */
describe("assertSecureCookiesConfigured", () => {
  describe("permits the configurations it exists to allow", () => {
    it("passes the shape .env.compose.example ships: downgrade on, browsed at http://localhost", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes a plain dev server: no override, NODE_ENV development, loopback origin", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it.each([
      "http://127.0.0.1:7000",
      "http://127.0.0.53:7000",
      "http://[::1]:7000",
      "http://portal.localhost:7000",
      "https://localhost:7000",
    ])("passes the loopback origin %s", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes any origin at all once Secure is on", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "true");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes when the base URL is absent or unparseable, which is a different defect", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });
  });

  describe("refuses the downgrade off loopback", () => {
    it.each([
      "https://forms.example.test",
      "http://forms.example.test",
      "http://192.168.1.10:7000",
      "http://0.0.0.0:7000",
      // A name that merely CONTAINS localhost is not loopback, and an attacker-chosen
      // hostname is exactly where a sloppy substring check would let the downgrade out.
      "http://localhost.forms.example.test",
    ])("refuses %s when the override is false", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
    });

    it("refuses when the downgrade came from NODE_ENV rather than the override", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(/NODE_ENV is not "production"/);
    });

    it("refuses every false spelling, not only the literal `false`", () => {
      // Since issue #401 all four spellings parse as false, so all four reach the
      // guard and all four are refused. Before that ruling `off`/`0`/`no` fell through
      // to NODE_ENV and the refusal only fired by accident of the environment.
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      for (const raw of ["false", "0", "no", "off"]) {
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
      }
    });

    it.each(["off", "0", "no"])(
      "reports %o as the value it read rather than calling the variable unset",
      (raw) => {
        // What this pins is that the message names what the operator wrote (issue
        // #409). Branching on `raw === "false"` alone told someone who had written
        // `QCMS_SECURE_COOKIES=off` that it was unset, while they were looking at the
        // line that sets it.
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

        let message = "";
        try {
          assertSecureCookiesConfigured();
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toContain(`QCMS_SECURE_COOKIES is set to "${raw}"`);
        expect(message).not.toContain("is unset");
      },
    );

    it.each(["TRUE", " true", "  false  "])(
      "no longer reaches this guard with %o, because the reader decided it (issue #401)",
      (raw) => {
        // These used to fall through to NODE_ENV and produce a refusal whose message
        // quoted them back verbatim. The strict reader now settles them first: `TRUE`
        // and ` true` are Secure-on and the guard returns early, and `  false  ` is a
        // real downgrade whose message quotes the TRIMMED value, because that is what
        // was compared. Kept as a pair with the admin twin, which trims for the same
        // reason.
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

        if (raw.trim().toLowerCase() === "false") {
          expect(() => assertSecureCookiesConfigured()).toThrow(
            /QCMS_SECURE_COOKIES is set to "false"/,
          );
        } else {
          expect(() => assertSecureCookiesConfigured()).not.toThrow();
        }
      },
    );

    it("lets an unparseable value fail at the reader rather than reaching the guard", () => {
      // The boot still fails, and it fails naming the variable - it just fails one
      // layer earlier, which is the whole of the #401 ruling. The old behaviour was a
      // refusal that said "unset" about a variable the operator had set.
      vi.stubEnv("QCMS_SECURE_COOKIES", "banana");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(
        /QCMS_SECURE_COOKIES must be a boolean/,
      );
    });

    it.each([undefined, ""])("still reports %o as unset, which it is", (raw) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(
        /QCMS_SECURE_COOKIES is unset and NODE_ENV is not "production"/,
      );
    });

    it("names the variable, the observed condition and the remedy", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

      let message = "";
      try {
        assertSecureCookiesConfigured();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      // The variable that has to change, and the one that was read to decide.
      expect(message).toContain("QCMS_SECURE_COOKIES");
      expect(message).toContain("QCMS_PORTAL_BASE_URL");
      // What was observed, in both halves.
      expect(message).toContain('QCMS_SECURE_COOKIES is set to "false"');
      expect(message).toContain('"https://forms.example.test"');
      expect(message).toContain('host "forms.example.test" is not loopback');
      // The remedy, actionable without reading the source.
      expect(message).toContain("QCMS_SECURE_COOKIES=true");
      expect(message).toContain("HTTPS");
      expect(message).toContain("http://localhost");
      // SEC-8: no credential is echoed. The only values quoted are this flag and the
      // public origin, so nothing secret can reach a log through this path.
      expect(message).not.toMatch(/token|secret|password|key/i);
    });
  });
});

/**
 * The placeholder boot refusal (issue #491, SEC-8).
 *
 * The fixture is the **literal** value from the committed example files rather than an
 * invented string, so this goes red the moment the guard stops covering what an operator
 * would actually copy. The API's equivalent (`apps/api/src/config-placeholders.test.ts`)
 * makes the same choice for the same reason.
 *
 * Agreement between this app's vocabulary, the admin's and the API's is not asserted
 * here: it cannot be, because a cross-app assertion inside one app's Vitest project is
 * cached against that project's own inputs and would report green having never read the
 * file that broke it (`scripts/check-origin-guards.test.ts` records that lesson at
 * length). It is asserted from the repo root, in
 * `scripts/check-bff-config-guards.test.ts`.
 */
describe("assertNoPlaceholderSecrets", () => {
  /** Verbatim from the committed example files. */
  const SHIPPED = "replace-with-a-random-32-character-internal-token";

  it("passes a real-looking token", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468");
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
  });

  it("passes an unset or empty value, which is a different defect with its own error", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", undefined);
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
    vi.stubEnv("QCMS_INTERNAL_TOKEN", "");
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
  });

  it("the shipped placeholder is long enough to pass a length floor, which is why this exists", () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(32);
  });

  it("refuses the shipped placeholder and names the variable", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", SHIPPED);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/Refusing to start/);
  });

  it.each([
    "replace_with_a_random_32_character_internal_token",
    "REPLACE-WITH-A-RANDOM-32-CHARACTER-INTERNAL-TOKEN",
    "  replace-with-a-random-32-character-internal-token  ",
    "change-me-change-me-change-me-change-me",
    "changeme-changeme-changeme-changeme-abc",
    "your-internal-token-goes-right-here-ok",
    "example-value-not-for-production-use-x",
    "placeholder-value-not-for-production-x",
    "<generate a 32 character secret here>",
    "replace-before-you-deploy-a-real-key",
  ])("refuses the other spellings an example file might carry: %s", (value) => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", value);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
  });

  it("refuses a placeholder hiding among real entries in a rotation list", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", `8f2c1a9e4b7d6053a1c8e2f4b6d80917,${SHIPPED}`);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
  });

  it("never echoes the refused value, only the variable name (SEC-8)", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", SHIPPED);
    let message = "";
    try {
      assertNoPlaceholderSecrets();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("QCMS_INTERNAL_TOKEN");
    expect(message).not.toContain(SHIPPED);
  });

  it("looksLikePlaceholder does not treat real material as a placeholder", () => {
    for (const value of [
      "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468ace13579bdf02468",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "correct-horse-battery-staple-and-then-some-more",
    ]) {
      expect(looksLikePlaceholder(value)).toBe(false);
    }
  });
});
