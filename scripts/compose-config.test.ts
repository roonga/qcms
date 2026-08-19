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
 *    app services. A third upstream fails whatever it points at, which is the
 *    shape that catches `api:3000` being added "just for a health probe".
 *
 * These need a working Docker CLI, which `pnpm test` already requires (the
 * Testcontainers suites boot Postgres).
 *
 * A third configuration joined the first two in issue #417: the developer-toolbox
 * overlay, which is the first overlay to add *published* services. Its section at
 * the bottom explains why that made the solo assertion sharper rather than looser.
 */

/** The two services ADR-20 says are never publicly reachable. */
const UNPUBLISHED_SERVICES = ["api", "postgres"] as const;

/** Interpolation the proxy overlay demands; the values are irrelevant to the shape. */
const PROXY_ENV = {
  QCMS_PORTAL_DOMAIN: "forms.example.test",
  QCMS_ADMIN_DOMAIN: "authoring.example.test",
  QCMS_ACME_EMAIL: "ops@example.test",
};

/**
 * The one variable the dev-tools overlay demands, and it demands it rather than
 * defaulting it: the read-only database role is a credential, so there is no value
 * this repo could pick that would not end up in somebody's running stack. The shape
 * is all these tests care about, hence a placeholder rather than anything usable.
 *
 * Deliberately NOT added to `.env.compose.example`: that file is the operator's, and
 * the overlay is a developer's. `docs/DEVELOPER_GUIDE.md` is where it is documented.
 */
const DEV_TOOLS_ENV = {
  QCMS_DB_VIEWER_PASSWORD: "placeholder-not-a-real-password",
};

/** The services `docker-compose.dev-tools.yml` adds, none of which ever ships. */
const DEV_TOOLS_SERVICES = ["lgtm", "pgweb", "dev-tools-role"] as const;

let solo: unknown;
let withProxy: unknown;
let withDevTools: unknown;

beforeAll(() => {
  solo = composeConfig({ files: ["docker-compose.yml"] });
  withProxy = composeConfig({
    files: ["docker-compose.yml", "docker-compose.proxy.yml"],
    env: PROXY_ENV,
  });
  withDevTools = composeConfig({
    files: ["docker-compose.yml", "docker-compose.dev-tools.yml"],
    env: DEV_TOOLS_ENV,
  });
}, 180_000);

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

/**
 * The developer-toolbox overlay (issue #417, ADR-37 amendment 2026-08-07).
 *
 * This overlay is the first thing in the repo that adds **published** services to
 * the merged configuration, which is precisely the shape the solo assertion above
 * ("publishes portal and admin, and nothing else") exists to catch. So the pair of
 * properties has to be split rather than relaxed: the base invocation stays exactly
 * two published services and gains none of these containers, and the overlay is
 * allowed its two UIs while everything ADR-20 protects stays untouched underneath.
 *
 * Relaxing the solo assertion to "portal, admin, and any dev tool" would have been
 * the easy edit and would have deleted the guarantee: `api` publishing a port would
 * then only need to be spelled as a dev tool to pass.
 */
interface ServiceDefinition {
  build?: {
    context?: string;
    dockerfile?: string;
    args?: Record<string, string>;
  };
  environment?: Record<string, string>;
  entrypoint?: string[];
  image?: string;
  volumes?: unknown[];
}

function service(config: unknown, name: string): ServiceDefinition {
  const services = (config as { services: Record<string, ServiceDefinition> }).services;
  const definition = services[name];
  if (definition === undefined) throw new Error(`no service named "${name}"`);
  return definition;
}

describe("developer-toolbox overlay", () => {
  it("is absent from the default invocation", () => {
    // The guarantee that lets everything else here be permissive. An operator who
    // types `docker compose up` gets the ADR-20 topology and nothing else.
    const services = Object.keys((solo as { services: Record<string, unknown> }).services);
    for (const name of DEV_TOOLS_SERVICES) {
      expect(services, `${name} must not be in the base stack`).not.toContain(name);
    }
  });

  it("still publishes no host port for api or postgres once layered on", () => {
    for (const name of UNPUBLISHED_SERVICES) {
      expect(publishedPorts(withDevTools, name), `${name} must stay unpublished`).toEqual([]);
    }
  });

  it("adds exactly two published services, both of them UIs", () => {
    const services = (withDevTools as { services: Record<string, unknown> }).services;
    const publishing = Object.keys(services)
      .filter((name) => publishedPorts(withDevTools, name).length > 0)
      .sort();
    expect(publishing).toEqual(["admin", "lgtm", "pgweb", "portal"]);
  });

  it("publishes no OTLP ingest port", () => {
    // The apps reach the collector at `lgtm:4318` over the Compose network, so the
    // dashboard costs one slot rather than two (ADR-37 amendment). A publish of
    // 4317 or 4318 would be a third allocation nobody decided on.
    //
    // Asserted on the CONTAINER side, because the host side is a seat's business and
    // a developer with a seat exported in their shell would fail a literal.
    const published = publishedPorts(withDevTools, "lgtm");
    expect(published).toHaveLength(1);
    expect(published[0], "only Grafana's UI is published").toMatch(/:3000\/tcp$/);
  });

  it("builds the LGTM wrapper with the provisioned QCMS home dashboard", () => {
    const lgtm = service(withDevTools, "lgtm");
    expect(lgtm.image).toBe("qcms-lgtm:local");
    expect(lgtm.build?.dockerfile?.replaceAll("\\", "/")).toMatch(
      /(?:^|\/)docker\/lgtm\.Dockerfile$/,
    );
    expect(lgtm.environment?.GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH).toBe(
      "/otel-lgtm/grafana/conf/provisioning/dashboards/qcms/qcms-observability.json",
    );
    // ADR-29: a relative bind mount would resolve on the host daemon and fail for
    // the canonical dev-container client. The wrapper image copies the files.
    expect(lgtm.volumes ?? []).toEqual([]);

    const dashboard = JSON.parse(
      readFileSync(`${REPOSITORY_ROOT}/docker/grafana/qcms-observability.json`, "utf8"),
    ) as { uid?: string; panels?: Array<{ datasource?: { uid?: string } }> };
    expect(dashboard.uid).toBe("qcms-observability");
    expect(dashboard.panels?.some((panel) => panel.datasource?.uid === "loki")).toBe(true);
  });

  it("binds every tool to loopback, unconditionally", () => {
    // Unconditionally: unlike the base file's publishes, these do NOT follow
    // QCMS_BIND_ADDRESS. One of them is a dashboard with a default login and the
    // other holds a database credential; there is no deployment in which widening
    // them is right, so the address is not a variable here.
    //
    // Comments are stripped first, for the same reason the Caddyfile's are above:
    // the overlay's header explains at length WHY it does not follow that variable,
    // and a match inside the explanation would make this assertion permanently red.
    const devToolsConfig = readFileSync(`${REPOSITORY_ROOT}/docker-compose.dev-tools.yml`, "utf8");
    expect(devToolsConfig.replaceAll(/^\s*#.*$/gm, "")).not.toContain("QCMS_BIND_ADDRESS");
    for (const name of ["lgtm", "pgweb"]) {
      for (const entry of publishedPorts(withDevTools, name)) {
        expect(entry, `${name} should publish on loopback`).toMatch(/^127\.0\.0\.1:/);
      }
    }
  });

  it("connects the database viewer as the read-only role, never as the application user", () => {
    // The one credentialed database client in the topology after task 056 removed
    // the admin's (ADR-35). What makes that acceptable is which credential it holds.
    const url = new URL(service(withDevTools, "pgweb").environment?.PGWEB_DATABASE_URL ?? "");
    expect(url.username).toBe("qcms_ro");
    const applicationUser = service(withDevTools, "api").environment?.DATABASE_URL ?? "";
    expect(applicationUser).not.toBe("");
    expect(new URL(applicationUser).username).not.toBe(url.username);
  });

  it("grants that role reads and never writes", () => {
    // Read from the RESOLVED entrypoint rather than from the file, so this asserts
    // the statements the container will actually run. It also needs no comment
    // stripping: the YAML comments around it discuss `pg_write_all_data` at length,
    // and a text search of the file would match the explanation of its absence.
    const sql = (service(withDevTools, "dev-tools-role").entrypoint ?? []).join("\n");
    expect(sql).toContain("GRANT pg_read_all_data TO qcms_ro");
    expect(sql).not.toContain("pg_write_all_data");
    // Read-only at the ROLE, which is the layer that holds. pgweb also asks per query
    // (`--readonly`), but that is a session setting on whichever pooled connection the
    // query lands on, so it is defence in depth rather than the control.
    expect(sql).toContain("ALTER ROLE qcms_ro SET default_transaction_read_only = on");
    expect(service(withDevTools, "pgweb")).toHaveProperty("command", ["--readonly"]);
  });
});

describe("OTLP export plumbing (ADR-34)", () => {
  it("names the endpoint variable on all apps, so Compose forwards it at all", () => {
    // Compose forwards ONLY what a service names in `environment:`. Before issue
    // #417 neither original app named this one, so setting it in .env reached nothing and the
    // composed stack could not export telemetry however it was configured. This is
    // the assertion that would have failed then.
    for (const name of ["api", "portal", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the OTLP endpoint`,
      ).toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
    }
  });

  it("leaves it empty in the shipped stack, which means no SDK starts", () => {
    // ADR-34: unset is a hard no-op, not "export to a collector nobody runs". The
    // shipped topology carries no collector, so empty is the only correct default.
    for (const name of ["api", "portal", "admin"]) {
      expect(service(solo, name).environment?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("");
    }
  });

  it("points all apps at the overlay's collector by service name", () => {
    for (const name of ["api", "portal", "admin"]) {
      expect(service(withDevTools, name).environment?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "http://lgtm:4318",
      );
    }
  });

  it("keeps the one-shot migration out of the trace backend", () => {
    // `migrate` shares the API's environment anchor, so an endpoint added there
    // rather than on the service would give a backend a service that never sends.
    expect(service(withDevTools, "migrate").environment).not.toHaveProperty(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
    );
  });
});
