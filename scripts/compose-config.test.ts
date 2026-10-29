import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { composeConfig, publishedPorts, REPOSITORY_ROOT } from "./docker.mjs";

const UNPUBLISHED_SERVICES = ["api", "postgres"] as const;

const PROXY_ENV = {
  QCMS_PORTAL_DOMAIN: "forms.example.test",
  QCMS_ADMIN_DOMAIN: "authoring.example.test",
  QCMS_ACME_EMAIL: "ops@example.test",
};

/**
 * A placeholder, and the overlay demands the variable rather than defaulting it: the
 * read-only role is a credential, so no value this repo picked would be safe to ship.
 */
const DEV_TOOLS_ENV = {
  QCMS_DB_VIEWER_PASSWORD: "placeholder-not-a-real-password",
};

const DEV_TOOLS_SERVICES = ["lgtm", "pgweb", "dev-tools-role", "seed"] as const;

const PROFILED_SERVICES = ["seed"] as const;

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
    // A bare publish would bind 0.0.0.0, ahead of the host firewall.
    for (const service of ["portal", "admin"]) {
      for (const entry of publishedPorts(solo, service)) {
        expect(entry, `${service} should publish on loopback`).toMatch(/^127\.0\.0\.1:/);
      }
    }
  });

  it("runs migration as its own service rather than on API boot", () => {
    const migrate = (solo as { services: Record<string, { restart?: string }> }).services.migrate;
    expect(migrate).toBeDefined();
    expect(migrate.restart).toBe("no");
  });
});

describe("least-privilege database roles (SEC-10, issues #492 and #995)", () => {
  function databaseRole(name: string): string {
    const url = service(solo, name).environment?.DATABASE_URL ?? "";
    expect(url, `${name} must carry a DATABASE_URL`).not.toBe("");
    return new URL(url).username;
  }

  function environmentRole(name: string, environment: string): string {
    const key = `QCMS_DATABASE_URL_${environment.toUpperCase()}`;
    const url = (service(solo, name).environment ?? {})[key] ?? "";
    expect(url, `${name} must carry a ${key}`).not.toBe("");
    return new URL(url).username;
  }

  it("runs the migration as the schema-owning role", () => {
    expect(databaseRole("migrate")).toBe("qcms_migrate");
  });

  it("runs the API's control pool as the control role, never as the migration role", () => {
    expect(databaseRole("api")).toBe("qcms_app_control");
    expect(databaseRole("api")).not.toBe(databaseRole("migrate"));
  });

  it.each(["test", "prod"])("runs the %s pool as that environment's own role", (environment) => {
    expect(environmentRole("api", environment)).toBe(`qcms_app_${environment}`);
  });

  it("gives every pool a credential of its own", () => {
    // Distinct passwords are what make the role boundary a control rather than a
    // convention: a shared one would let the control credential connect as an
    // environment role.
    const credentials = [
      new URL(service(solo, "api").environment?.DATABASE_URL ?? "").password,
      ...["test", "prod"].map(
        (environment) =>
          new URL(
            (service(solo, "api").environment ?? {})[
              `QCMS_DATABASE_URL_${environment.toUpperCase()}`
            ] ?? "",
          ).password,
      ),
    ];
    expect(new Set(credentials).size).toBe(credentials.length);
  });

  it("names the same environment set the API is configured with", () => {
    const configured = (service(solo, "api").environment?.QCMS_ENVIRONMENTS ?? "").split(",");
    for (const environment of configured) {
      expect(environmentRole("api", environment.trim())).toBe(`qcms_app_${environment.trim()}`);
    }
  });

  it("keeps the bootstrap superuser out of every pool", () => {
    for (const name of ["api", "migrate"]) {
      expect(databaseRole(name), `${name} must not use the bootstrap credential`).not.toBe("qcms");
    }
    for (const environment of ["test", "prod"]) {
      expect(environmentRole("api", environment)).not.toBe("qcms");
    }
  });

  it("creates the roles in a one-shot that the migration waits for", () => {
    // The roles must exist and own the schemas before drizzle-kit connects, because the
    // baseline's grants are guarded on each role existing.
    const roles = (solo as { services: Record<string, { restart?: string }> }).services["db-roles"];
    expect(roles).toBeDefined();
    expect(roles?.restart).toBe("no");
    expect(publishedPorts(solo, "db-roles")).toEqual([]);

    const dependsOn = (
      solo as { services: Record<string, { depends_on?: Record<string, unknown> }> }
    ).services.migrate.depends_on;
    expect(dependsOn?.["db-roles"]).toMatchObject({
      condition: "service_completed_successfully",
    });
  });

  it("creates every application role the API is configured to use, and grants none of them", () => {
    const sql = (service(solo, "db-roles").entrypoint ?? []).join("\n");
    for (const role of ["qcms_migrate", "qcms_app_control", "qcms_app_test", "qcms_app_prod"]) {
      expect(sql, `${role} must be created by the one-shot`).toContain(`CREATE ROLE ${role} LOGIN`);
    }
    for (const line of sql.split("\n")) {
      if (!/\bGRANT\b/.test(line)) continue;
      expect(line, `only qcms_migrate may be granted anything here: ${line}`).not.toMatch(
        /qcms_app/,
      );
    }
  });

  it("leaves `public` with CREATE granted to nobody", () => {
    const sql = (service(solo, "db-roles").entrypoint ?? []).join("\n");
    expect(sql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  });

  it("never tries to reassign a table's linked sequence", () => {
    // Postgres refuses `ALTER SEQUENCE ... OWNER TO` on a sequence linked to a `SERIAL`
    // column, so the handover excludes it via `pg_depend`.
    const sql = (service(solo, "db-roles").entrypoint ?? []).join("\n");
    expect(sql).toContain("pg_depend");
    expect(sql).toContain("d.deptype IN ('a', 'i')");
  });

  it("excludes the system schemas with a LIKE escape that is ONE backslash", () => {
    // A YAML block scalar processes no escapes, so `'pg\_%'` reaches psql as LIKE's
    // escape for one literal underscore. Doubled, it matches nothing, no system schema is
    // excluded, and the one-shot aborts under ON_ERROR_STOP. Hence a text assertion.
    for (const path of [
      "docker-compose.yml",
      "packages/create-qcms-app/templates/common/docker-compose.yml",
    ]) {
      const text = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
      expect(text, path).toContain("NOT LIKE 'pg\\_%'");
      expect(text, path).not.toContain("NOT LIKE 'pg\\\\_%'");
    }
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
    // Stripped first: a match inside the comment explaining their absence would make this
    // assertion permanently red.
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

  it("keeps the profiled services out of its own default invocation", () => {
    const services = Object.keys((withDevTools as { services: Record<string, unknown> }).services);
    for (const name of PROFILED_SERVICES) {
      expect(services, `${name} must be reachable only with its profile`).not.toContain(name);
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
    // Asserted on the container side: the host side is a seat's business.
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
    // ADR-29: a relative bind mount would resolve on the host daemon and fail for the
    // dev-container client, so the wrapper image copies the files.
    expect(lgtm.volumes ?? []).toEqual([]);

    const dashboard = JSON.parse(
      readFileSync(`${REPOSITORY_ROOT}/docker/grafana/qcms-observability.json`, "utf8"),
    ) as { uid?: string; panels?: Array<{ datasource?: { uid?: string } }> };
    expect(dashboard.uid).toBe("qcms-observability");
    expect(dashboard.panels?.some((panel) => panel.datasource?.uid === "loki")).toBe(true);
  });

  it("binds every tool to loopback, unconditionally", () => {
    // These deliberately do not follow QCMS_BIND_ADDRESS: one is a dashboard with a
    // default login and the other holds a database credential.
    // Comments stripped first, for the reason the Caddyfile's are above.
    const devToolsConfig = readFileSync(`${REPOSITORY_ROOT}/docker-compose.dev-tools.yml`, "utf8");
    expect(devToolsConfig.replaceAll(/^\s*#.*$/gm, "")).not.toContain("QCMS_BIND_ADDRESS");
    for (const name of ["lgtm", "pgweb"]) {
      for (const entry of publishedPorts(withDevTools, name)) {
        expect(entry, `${name} should publish on loopback`).toMatch(/^127\.0\.0\.1:/);
      }
    }
  });

  it("connects the database viewer as the read-only role, never as the application user", () => {
    const url = new URL(service(withDevTools, "pgweb").environment?.PGWEB_DATABASE_URL ?? "");
    expect(url.username).toBe("qcms_ro");
    const applicationUser = service(withDevTools, "api").environment?.DATABASE_URL ?? "";
    expect(applicationUser).not.toBe("");
    expect(new URL(applicationUser).username).not.toBe(url.username);
  });

  it("grants that role reads and never writes", () => {
    const sql = (service(withDevTools, "dev-tools-role").entrypoint ?? []).join("\n");
    expect(sql).toContain("GRANT pg_read_all_data TO qcms_ro");
    expect(sql).not.toContain("pg_write_all_data");
    // Read-only at the role is the control; pgweb's own `--readonly` is a session setting
    // on a pooled connection, so defence in depth rather than the boundary.
    expect(sql).toContain("ALTER ROLE qcms_ro SET default_transaction_read_only = on");
    expect(service(withDevTools, "pgweb")).toHaveProperty("command", ["--readonly"]);
  });
});

describe("OTLP export plumbing (ADR-34)", () => {
  it("names the endpoint variable on all apps, so Compose forwards it at all", () => {
    for (const name of ["api", "portal", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the OTLP endpoint`,
      ).toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
    }
  });

  it("leaves it empty in the shipped stack, which means no SDK starts", () => {
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
    expect(service(withDevTools, "migrate").environment).not.toHaveProperty(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
    );
  });
});

describe("managed portal theme plumbing (ADR-30, issue #499)", () => {
  it("names the variable on both apps, so Compose forwards it at all", () => {
    for (const name of ["portal", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the managed portal theme`,
      ).toHaveProperty("QCMS_PORTAL_THEME");
    }
  });

  it("leaves it empty by default, so each app applies its own documented fallback", () => {
    // Forced empty rather than reusing `solo`: `composeConfig` inherits `process.env` and
    // the browser harness exports this variable, so a developer would otherwise fail here
    // having changed nothing.
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: { QCMS_PORTAL_THEME: "" },
    });
    for (const name of ["portal", "admin"]) {
      expect(service(unset, name).environment?.QCMS_PORTAL_THEME).toBe("");
    }
  });

  it("keeps the theme off the API and the one-shot migration", () => {
    for (const name of ["api", "migrate"]) {
      expect(service(solo, name).environment).not.toHaveProperty("QCMS_PORTAL_THEME");
    }
  });
});

describe("operator locale plumbing (Code Owner ruling 2026-10-19, ADR-27)", () => {
  it("names QCMS_LOCALE on both apps, so one value reaches both", () => {
    for (const name of ["portal", "admin"]) {
      expect(service(solo, name).environment, `${name} must forward QCMS_LOCALE`).toHaveProperty(
        "QCMS_LOCALE",
      );
    }
  });

  it("leaves it empty by default, so each app applies its own en-GB default", () => {
    const unset = composeConfig({ files: ["docker-compose.yml"], env: { QCMS_LOCALE: "" } });
    for (const name of ["portal", "admin"]) {
      expect(service(unset, name).environment?.QCMS_LOCALE).toBe("");
    }
  });

  it("keeps it off the API and the one-shot migration, which format nothing for a reader", () => {
    for (const name of ["api", "migrate"]) {
      expect(service(solo, name).environment).not.toHaveProperty("QCMS_LOCALE");
    }
  });
});

describe("portal appearance-group plumbing (ADR-30, issue #752)", () => {
  const appearanceVars = (() => {
    const source = readFileSync(`${REPOSITORY_ROOT}/apps/portal/lib/server/theme.ts`, "utf8");
    const names = new Set<string>();
    for (const match of source.matchAll(/process\.env\.(QCMS_PORTAL_[A-Z0-9_]+)/gu)) {
      names.add(match[1]!);
    }
    return [...names].sort();
  })();

  it("reads the group off the portal's own config module, so the list cannot go stale", () => {
    // A floor on the derivation: were the regex to stop matching, every assertion below
    // would pass over an empty list and certify nothing.
    expect(appearanceVars.length).toBeGreaterThanOrEqual(7);
    expect(appearanceVars).toContain("QCMS_PORTAL_BRAND_NAME");
  });

  it("names every appearance variable on the portal service", () => {
    const environment = service(solo, "portal").environment;
    for (const name of appearanceVars) {
      expect(environment, `portal must forward ${name}`).toHaveProperty(name);
    }
  });

  it("leaves each one empty by default, so the portal applies its own documented fallback", () => {
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: Object.fromEntries(appearanceVars.map((name) => [name, ""])),
    });
    const environment = service(unset, "portal").environment;
    for (const name of appearanceVars) {
      expect(environment?.[name], `${name} must default to empty`).toBe("");
    }
  });

  it("keeps the group off the admin, the API and the one-shot migration", () => {
    const rest = appearanceVars.filter((name) => name !== "QCMS_PORTAL_THEME");
    for (const serviceName of ["admin", "api", "migrate"]) {
      const environment = service(solo, serviceName).environment;
      for (const name of rest) {
        expect(environment, `${serviceName} must not forward ${name}`).not.toHaveProperty(name);
      }
    }
  });
});

describe("admin TOTP policy plumbing (SEC-1)", () => {
  it("names the variable on both sides, so the documented escape hatch is reachable", () => {
    for (const name of ["api", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the admin TOTP policy`,
      ).toHaveProperty("QCMS_ADMIN_2FA");
    }
  });

  it("defaults to required, so a stack started with nothing set enforces 2FA", () => {
    // Reachability, not a relaxed default: SEC-1 is enforced by default in every
    // environment, and no general-purpose signal may decide a security control.
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: { QCMS_ADMIN_2FA: "" },
    });
    for (const name of ["api", "admin"]) {
      expect(service(unset, name).environment?.QCMS_ADMIN_2FA).toBe("required");
    }
  });

  it("keeps the one-shot migration out of the auth policy", () => {
    expect(service(solo, "migrate").environment).not.toHaveProperty("QCMS_ADMIN_2FA");
  });
});

describe("agent-authoring plumbing (task 041, ADR-25, issue #1063)", () => {
  const apiVars = [
    "QCMS_FLAG_AGENT_AUTHORING",
    "QCMS_AGENT_MODEL",
    "QCMS_AGENT_API_KEY",
    "QCMS_AGENT_BASE_URL",
    "QCMS_AGENT_MAX_STEPS",
    "QCMS_RL_AGENT_ASSIST_WINDOW_MS",
    "QCMS_RL_AGENT_ASSIST_MAX",
  ];

  it("names every documented variable on the api service, so the feature is reachable", () => {
    const environment = service(solo, "api").environment;
    for (const name of apiVars) {
      expect(environment, `api must forward ${name}`).toHaveProperty(name);
    }
  });

  it("forwards the flag to the admin, which decides whether the panel renders", () => {
    expect(service(solo, "admin").environment).toHaveProperty("QCMS_FLAG_AGENT_AUTHORING");
  });

  it("keeps the model, the key and the endpoint off the admin and the migration", () => {
    // ADR-25: the key never reaches the browser, and the migration must not inherit a
    // provider credential through the shared anchor.
    const apiOnly = apiVars.filter((name) => name !== "QCMS_FLAG_AGENT_AUTHORING");
    for (const name of apiOnly) {
      expect(
        service(solo, "admin").environment,
        `admin must not forward ${name}`,
      ).not.toHaveProperty(name);
    }
    for (const name of apiVars) {
      expect(
        service(solo, "migrate").environment,
        `migrate must not forward ${name}`,
      ).not.toHaveProperty(name);
    }
  });

  it("defaults every one to empty, so a stack started with nothing set keeps the feature off", () => {
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: Object.fromEntries(apiVars.map((name) => [name, ""])),
    });
    for (const name of apiVars) {
      expect(service(unset, "api").environment?.[name], `${name} must default to empty`).toBe("");
    }
    expect(service(unset, "admin").environment?.QCMS_FLAG_AGENT_AUTHORING).toBe("");
  });
});
