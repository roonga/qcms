import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENV_REFERENCE } from "./env-reference.mjs";

const RECIPE = fileURLToPath(new URL("../docs/deploy-ingress.md", import.meta.url));
const CADDYFILE = fileURLToPath(new URL("../docker/Caddyfile", import.meta.url));
const PORTAL_PROXY = fileURLToPath(new URL("../apps/portal/proxy.ts", import.meta.url));
const API_APP = fileURLToPath(new URL("../apps/api/src/app.ts", import.meta.url));

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
      expect(ENV_REFERENCE.map((entry: { name: string }) => entry.name)).toContain(name);
      expect(recipe).toContain(name);
    },
  );

  it("names QCMS_MOUNT, because the two halves have to agree", () => {
    expect(recipe).toContain("QCMS_MOUNT");
  });
});

describe("the recipe's address claims match what the product serves", () => {
  const recipe = section();

  it("claims no anonymous entry under a prefix, which the portal's proxy enforces", () => {
    expect(recipe).toContain("/test/f/{slug}");
    expect(recipe).toMatch(/not\*{0,2}\s+a route/i);
    const proxy = readFileSync(PORTAL_PROXY, "utf8");
    expect(proxy).toContain("isAnonymousEntry");
    expect(proxy).toContain("qcms-no-such-route");
  });

  it("claims prod is unprefixed, which is the one derivation both surfaces share", () => {
    expect(recipe).toMatch(/`prod` carries none|all unprefixed|unprefixed paths only/);
    // Compared by shape rather than by import: the two apps share no module (R2), so what
    // keeps them in step is that each derives the same prefix from the environment name.
    expect(readFileSync(API_APP, "utf8")).toContain("export function environmentPrefix");
  });

  it("pairs the two path rules in both directions", () => {
    // Whitespace-insensitive, because the document is hard-wrapped and a reflow must not
    // fail the gate.
    const flat = recipe.replace(/\s+/g, " ");
    expect(flat).toContain("deny `/<env>/` on the prod hostname");
    expect(flat).toContain("deny an unprefixed path on a non-prod one");
  });

  it("keeps both Caddy address matchers and the reason for choosing between them", () => {
    // Fails permissively: `remote_ip` behind a CDN matches the CDN's egress node, so every
    // request looks allowlisted.
    expect(recipe).toContain("remote_ip");
    expect(recipe).toContain("client_ip");
    expect(recipe).toContain("trusted_proxies");
  });
});

describe("the shipped stack is prod-only, so the recipe is what adds a surface", () => {
  it("ships no non-prod site block in the Caddy overlay", () => {
    const caddy = readFileSync(CADDYFILE, "utf8");
    expect(caddy.match(/^\{\$QCMS_[A-Z_]+\} \{$/gm)).toHaveLength(2);
    expect(caddy).not.toContain("QCMS_TEST_DOMAIN");
  });

  it("leaves the portal's non-prod set empty by default, which is the fail-closed direction", () => {
    const compose = readFileSync(
      fileURLToPath(new URL("../docker-compose.yml", import.meta.url)),
      "utf8",
    );
    expect(compose).toContain("QCMS_PORTAL_ENVIRONMENTS: ${QCMS_PORTAL_ENVIRONMENTS:-}");
    expect(compose).toContain("QCMS_PORTAL_ENVIRONMENT_HOSTS: ${QCMS_PORTAL_ENVIRONMENT_HOSTS:-}");
  });
});
