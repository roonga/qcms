import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENV_REFERENCE } from "./env-reference.mjs";

/**
 * SEC-14's operator recipe describes the product as it is (task 066).
 *
 * ## What this gate is for, and what it cannot be for
 *
 * The "Restricting the test environment" section of `docs/deploy-ingress.md` is the
 * operator half of SEC-14: a hostname, a certificate, an allowlist and a pair of path
 * rules. None of that is runnable here - QCMS terminates no TLS and owns no ingress
 * (ADR-20), so there is no Caddy and no ALB in this repository's tests to point at.
 *
 * What IS checkable is the thing a drafted recipe gets wrong: **drift between the
 * addresses the recipe writes rules about and the addresses the product serves.** That is
 * the failure mode worth a gate, because it is silent on both sides - a new respondent
 * route appears, the recipe's path rules keep matching the old set, and an operator
 * following the document leaves an address unprotected while every test still passes.
 *
 * So each assertion below pins one claim the recipe makes against the source that decides
 * it. The app half of SEC-14 is asserted where it belongs, against running code:
 * `apps/api/src/features/responses/start-session/environment-addresses.integration.test.ts`
 * for the mount split's `404`, and `apps/portal/proxy.test.ts` for the portal's two
 * refusals.
 */

const RECIPE = fileURLToPath(new URL("../docs/deploy-ingress.md", import.meta.url));
const CADDYFILE = fileURLToPath(new URL("../docker/Caddyfile", import.meta.url));
const PORTAL_PROXY = fileURLToPath(new URL("../apps/portal/proxy.ts", import.meta.url));
const API_APP = fileURLToPath(new URL("../apps/api/src/app.ts", import.meta.url));

/** The "Restricting the test environment" section, and nothing above or below it. */
function section(): string {
  const text = readFileSync(RECIPE, "utf8");
  const start = text.indexOf("## Restricting the test environment");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n## ", start + 1);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

describe("the recipe names the product variables it pairs with", () => {
  const recipe = section();

  it.each(["QCMS_PORTAL_ENVIRONMENTS", "QCMS_PORTAL_ENVIRONMENT_HOSTS"])(
    "writes %s exactly as the operator table spells it",
    (name) => {
      // Both directions. The variable has to exist in the generated operator reference,
      // so a rename breaks the recipe here rather than leaving an operator setting a
      // variable nothing reads; and the recipe has to name it, so a variable added for
      // this control cannot land without the document that tells somebody to set it.
      expect(ENV_REFERENCE.map((entry: { name: string }) => entry.name)).toContain(name);
      expect(recipe).toContain(name);
    },
  );

  it("names QCMS_MOUNT, because the two halves have to agree", () => {
    // An address the portal serves and the API does not mount answers the API's 404
    // instead. That is confusing rather than dangerous, and it is exactly the kind of
    // half-configuration a recipe exists to prevent.
    expect(recipe).toContain("QCMS_MOUNT");
  });
});

describe("the recipe's address claims match what the product serves", () => {
  const recipe = section();

  it("claims no anonymous entry under a prefix, which the portal's proxy enforces", () => {
    expect(recipe).toContain("/test/f/{slug}");
    expect(recipe).toMatch(/not\*{0,2}\s+a route/i);
    // The enforcement, named from the source rather than trusted: the proxy refuses the
    // `/f` segment under a prefix and on a reserved host, and it does it by rewriting to
    // a path no route matches so the answer is a 404 and not a composed refusal.
    const proxy = readFileSync(PORTAL_PROXY, "utf8");
    expect(proxy).toContain("isAnonymousEntry");
    expect(proxy).toContain("qcms-no-such-route");
  });

  it("claims prod is unprefixed, which is the one derivation both surfaces share", () => {
    expect(recipe).toMatch(/`prod` carries none|all unprefixed|unprefixed paths only/);
    // `environmentPrefix` is that derivation on the API side, and the portal's own copy
    // is asserted against it by shape rather than by import: the two apps share no module
    // (R2), so what keeps them in step is that each derives `prod` -> "" from the name.
    expect(readFileSync(API_APP, "utf8")).toContain("export function environmentPrefix");
  });

  it("pairs the two path rules in both directions", () => {
    // Each direction closes what the other leaves open: deny a prefix on the prod
    // hostname, and deny an unprefixed path on a non-prod one. A recipe with one of the
    // two reads as complete and is not.
    // Whitespace-insensitive, because the document is hard-wrapped and a reflow must not
    // be a failing gate; what is pinned is the pair of clauses, not the line breaks.
    const flat = recipe.replace(/\s+/g, " ");
    expect(flat).toContain("deny `/<env>/` on the prod hostname");
    expect(flat).toContain("deny an unprefixed path on a non-prod one");
  });

  it("keeps both Caddy address matchers and the reason for choosing between them", () => {
    // The trap this spells out is the one that fails permissively: `remote_ip` behind a
    // CDN matches the CDN's egress node, so every request looks allowlisted.
    expect(recipe).toContain("remote_ip");
    expect(recipe).toContain("client_ip");
    expect(recipe).toContain("trusted_proxies");
  });
});

describe("the shipped stack is prod-only, so the recipe is what adds a surface", () => {
  it("ships no non-prod site block in the Caddy overlay", () => {
    const caddy = readFileSync(CADDYFILE, "utf8");
    // Two site blocks and two upstreams, which is the property `compose-config.test.ts`
    // also rests on. A third, hard-coded, non-prod block would be a surface the shipped
    // stack exposed without an operator asking for it - and it could carry no allowlist,
    // because the allowlist is the operator's network and not ours.
    expect(caddy.match(/^\{\$QCMS_[A-Z_]+\} \{$/gm)).toHaveLength(2);
    expect(caddy).not.toContain("QCMS_TEST_DOMAIN");
  });

  it("leaves the portal's non-prod set empty by default, which is the fail-closed direction", () => {
    // Compose passes the variable through with an empty default, so a stack nobody
    // configured serves `prod` only and every `/<env>/` address is a 404. The recipe is
    // what turns one on, deliberately, beside the hostname and the allowlist.
    const compose = readFileSync(fileURLToPath(new URL("../docker-compose.yml", import.meta.url)), "utf8");
    expect(compose).toContain("QCMS_PORTAL_ENVIRONMENTS: ${QCMS_PORTAL_ENVIRONMENTS:-}");
    expect(compose).toContain("QCMS_PORTAL_ENVIRONMENT_HOSTS: ${QCMS_PORTAL_ENVIRONMENT_HOSTS:-}");
  });
});
