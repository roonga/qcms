import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { composeConfig, publishedPorts, REPOSITORY_ROOT } from "./docker.mjs";

/**
 * The ADR-20 topology gate (task 036, exit criterion 5).
 *
 * ADR-20 makes two promises about the solo stack that are worth more than a
 * comment: **the API container publishes no host port**, and **ingress routes only
 * portal and admin**. Both hold today by inspection. Inspection is exactly what
 * stops happening once a hurried operator adds `ports:` to the `api` service to
 * debug something and never takes it out again, so they are asserted here.
 *
 * Two design choices are load-bearing:
 *
 * 1. **Compose resolves the configuration, not us.** These tests shell out to
 *    `docker compose config`, which applies Compose's own interpolation and its own
 *    overlay-merge rules. A hand-rolled YAML read would assert against our guess at
 *    those rules; the merged document an operator gets is the only thing worth
 *    asserting against. It also means the overlay is checked as an overlay - the
 *    property that matters is "api publishes nothing AFTER docker-compose.proxy.yml
 *    is layered on", not "neither file mentions a port for api".
 * 2. **The Caddyfile is read as text.** Its upstreams are the routing policy, and
 *    the assertion is a whitelist: exactly two `reverse_proxy` lines, exactly the
 *    two app services. A third upstream fails whatever it points at, which is the
 *    shape that catches `api:3000` being added "just for a health probe".
 *
 * These need a working Docker CLI, which `pnpm test` already requires (the
 * Testcontainers suites boot Postgres).
 */

/** The two services ADR-20 says are never publicly reachable. */
const UNPUBLISHED_SERVICES = ["api", "postgres"] as const;

/** Interpolation the proxy overlay demands; the values are irrelevant to the shape. */
const PROXY_ENV = {
  QCMS_PORTAL_DOMAIN: "forms.example.test",
  QCMS_ADMIN_DOMAIN: "authoring.example.test",
  QCMS_ACME_EMAIL: "ops@example.test",
};

let solo: unknown;
let withProxy: unknown;

beforeAll(() => {
  solo = composeConfig({ files: ["docker-compose.yml"] });
  withProxy = composeConfig({
    files: ["docker-compose.yml", "docker-compose.proxy.yml"],
    env: PROXY_ENV,
  });
}, 120_000);

describe("solo compose topology (ADR-20)", () => {
  it.each(UNPUBLISHED_SERVICES)("publishes no host port for %s", (service) => {
    expect(publishedPorts(solo, service)).toEqual([]);
  });

  it("publishes portal and admin, and nothing else", () => {
    const publishing = Object.keys((solo as { services: Record<string, unknown> }).services)
      .filter((service) => publishedPorts(solo, service).length > 0)
      .sort();
    expect(publishing).toEqual(["admin", "portal"]);
  });

  it("binds both published apps to loopback by default", () => {
    // The base file's default is 127.0.0.1 rather than a bare "PORT:3000", because
    // a bare publish makes Docker listen on 0.0.0.0 - ahead of the host firewall -
    // which would put the authoring admin on every network the host can reach.
    for (const service of ["portal", "admin"]) {
      for (const entry of publishedPorts(solo, service)) {
        expect(entry, `${service} should publish on loopback`).toMatch(/^127\.0\.0\.1:/);
      }
    }
  });

  it("runs migration as its own service rather than on API boot", () => {
    // The "why" is in docs/operations.md; this is the shape that has to stay true
    // for that reasoning to hold: a one-shot service that does not restart.
    const migrate = (solo as { services: Record<string, { restart?: string }> }).services.migrate;
    expect(migrate).toBeDefined();
    expect(migrate.restart).toBe("no");
  });
});

describe("Caddy ingress overlay", () => {
  it("still publishes no host port for api or postgres once layered on", () => {
    for (const service of UNPUBLISHED_SERVICES) {
      expect(publishedPorts(withProxy, service), `${service} must stay unpublished`).toEqual([]);
    }
  });

  it("adds exactly one publicly bound service, the ingress itself", () => {
    const services = (withProxy as { services: Record<string, unknown> }).services;
    const public_ = Object.keys(services)
      .filter((service) =>
        publishedPorts(withProxy, service).some((entry) => !entry.startsWith("127.0.0.1:")),
      )
      .sort();
    expect(public_).toEqual(["caddy"]);
  });

  it("terminates the standard web ports on the ingress", () => {
    expect(publishedPorts(withProxy, "caddy").sort()).toEqual([
      "443:443/tcp",
      "443:443/udp",
      "80:80/tcp",
    ]);
  });

  it("routes only portal and admin", () => {
    const caddyfile = readFileSync(`${REPOSITORY_ROOT}/docker/Caddyfile`, "utf8");
    const upstreams = [...caddyfile.matchAll(/^\s*reverse_proxy\s+(\S+)/gm)].map(
      (match) => match[1],
    );
    expect(upstreams.sort()).toEqual(["admin:3000", "portal:3000"]);
  });

  it("never names the API or the database as an ingress upstream", () => {
    const caddyfile = readFileSync(`${REPOSITORY_ROOT}/docker/Caddyfile`, "utf8");
    // Comments explain WHY those two are absent, so strip them before looking:
    // a match inside the explanation would make this assertion permanently red,
    // and a maintainer would delete it rather than the offending route.
    const policy = caddyfile.replaceAll(/^\s*#.*$/gm, "");
    for (const forbidden of ["api:", "postgres:"]) {
      expect(policy, `the ingress must never reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("sets HSTS at the ingress, as SEC-9 requires of both recipes", () => {
    const caddyfile = readFileSync(`${REPOSITORY_ROOT}/docker/Caddyfile`, "utf8");
    expect(caddyfile).toMatch(/Strict-Transport-Security\s+"max-age=\d+/);
  });
});
