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
const DEV_TOOLS_SERVICES = ["lgtm", "pgweb", "dev-tools-role", "seed"] as const;

/**
 * The overlay services that are behind a profile, and so are absent even from the
 * overlay's own default invocation.
 *
 * `seed` loads the sample question library (`pnpm dev:seed`). It is profiled rather
 * than one-shot-on-every-up like `dev-tools-role`, because an empty library is a
 * legitimate state to want: it is the state every screen's empty-state copy is
 * reviewed against.
 */
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

/**
 * The SEC-10 app/migration credential split (issue #492).
 *
 * The Code Owner's ruling of 2026-09-02 is a property of the shipped Compose file,
 * not only of a document: `migrate` connects as `qcms_migrate`, which owns the schema
 * and holds the DDL rights, and `api` connects as `qcms_app`, which holds DML and
 * nothing else. Both values are resolved by Compose here rather than read out of the
 * YAML, because `api` gets its credential by OVERRIDING a key on the `*api-env`
 * anchor it shares with `migrate` - and "a directly written key wins over a merged
 * one" is exactly the kind of claim that deserves a test rather than a comment.
 *
 * The recipe both roles come from, and the reasoning for granting DELETE whole, are
 * in the "Least-privilege database roles" section of `docs/operations.md`.
 */
describe("least-privilege database roles (SEC-10, issue #492)", () => {
  /** The username in a service's resolved `DATABASE_URL`. */
  function databaseRole(name: string): string {
    const url = service(solo, name).environment?.DATABASE_URL ?? "";
    expect(url, `${name} must carry a DATABASE_URL`).not.toBe("");
    return new URL(url).username;
  }

  it("runs the migration as the schema-owning role", () => {
    expect(databaseRole("migrate")).toBe("qcms_migrate");
  });

  it("runs the API as the DML-only role, never as the migration role", () => {
    // The whole point of the split: the process that serves respondent and authoring
    // traffic holds a credential that cannot issue DDL. If the `<<: *api-env` merge
    // ever stopped being overridden, this is the assertion that fails.
    expect(databaseRole("api")).toBe("qcms_app");
    expect(databaseRole("api")).not.toBe(databaseRole("migrate"));
  });

  it("keeps the bootstrap superuser out of both", () => {
    // QCMS_DB_USER creates the two roles and is then held by nothing that serves
    // traffic. A service falling back to it would be the old single-credential world
    // wearing the new file's name.
    for (const name of ["api", "migrate"]) {
      expect(databaseRole(name), `${name} must not use the bootstrap credential`).not.toBe("qcms");
    }
  });

  it("creates the roles in a one-shot that the migration waits for", () => {
    // Ordering is the whole recipe: the roles must exist and own the schema before
    // drizzle-kit connects. `restart: "no"` because it is a one-shot like `migrate`.
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

  it("grants the runtime role DML and never CREATE", () => {
    // Read from the RESOLVED entrypoint, so this asserts the statements the container
    // will actually run, exactly as the dev-tools read-only role is asserted below.
    const sql = (service(solo, "db-roles").entrypoint ?? []).join("\n");
    expect(sql).toContain("GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public");
    expect(sql).toContain("GRANT USAGE ON SCHEMA %I TO qcms_app");
    expect(sql).toContain("ALTER SCHEMA %I OWNER TO qcms_migrate");
    // No CREATE for the runtime role, in any spelling. A plain text search would be
    // wrong in both directions here: `GRANT CREATE ON DATABASE` is present and
    // correct for qcms_migrate, and `CREATE ROLE qcms_app` is present as a string
    // literal. So the check is per grant statement, per grantee.
    for (const line of sql.split("\n")) {
      if (!/\bGRANT\b/.test(line) || !line.includes("qcms_app")) continue;
      expect(line, `qcms_app must never be granted CREATE: ${line}`).not.toMatch(/\bCREATE\b/);
    }
  });

  it("keeps every write grant scoped to public, so reporting stays a read surface", () => {
    // SEC-10 and the operations table both say qcms_app gets SELECT on the reporting
    // views and nothing more. The all-schemas pass therefore grants SELECT only, and
    // every write verb is confined to `public` by name (reviewer finding on PR #782:
    // an unscoped DML grant reached the reporting views once migration 0003 ran).
    // Per STATEMENT, not per line: `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public`
    // carries its scope on the line above its `GRANT`, so a line-wise reader would
    // call a correctly scoped grant unscoped. `;` and `\gexec` are what end a
    // statement in this script, and comments are stripped so the prose explaining
    // why `reporting` gets no write cannot itself match a write verb.
    const statements = (service(solo, "db-roles").entrypoint ?? [])
      .join("\n")
      .replaceAll(/^\s*--.*$/gm, "")
      .split(/;|\\gexec/)
      .map((statement) => statement.replaceAll(/\s+/g, " ").trim())
      .filter((statement) => statement.length > 0);

    const writeGrants = statements.filter(
      (statement) => /\bGRANT\b/.test(statement) && /\b(INSERT|UPDATE|DELETE)\b/.test(statement),
    );
    expect(writeGrants.length).toBeGreaterThan(0);
    for (const statement of writeGrants) {
      expect(statement, `a write grant must name public explicitly: ${statement}`).toMatch(
        /IN SCHEMA public\b/,
      );
      expect(
        statement,
        `a write grant must not fan out over every schema: ${statement}`,
      ).not.toContain("%I");
    }

    // And the unscoped default privilege is the SELECT one, and only the SELECT one:
    // it is what has to reach `reporting`, which does not exist when this runs.
    const unscopedDefaults = statements.filter(
      (statement) =>
        statement.startsWith("ALTER DEFAULT PRIVILEGES") && !/IN SCHEMA/.test(statement),
    );
    expect(unscopedDefaults.length).toBeGreaterThan(0);
    for (const statement of unscopedDefaults) {
      expect(
        statement,
        `an unscoped default must not carry a write verb: ${statement}`,
      ).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
  });

  it("never tries to reassign a table's linked sequence", () => {
    // drizzle's bookkeeping table declares `id SERIAL`, so an upgrading database
    // carries a sequence linked to it, and Postgres refuses ALTER SEQUENCE ... OWNER
    // TO on a linked sequence outright. Under ON_ERROR_STOP that aborted the whole
    // one-shot, so `migrate` and `api` never started: the exact path the handover
    // exists to serve. Excluded via pg_depend, which is order-independent - the
    // table's own owner change carries its sequence along.
    const sql = (service(solo, "db-roles").entrypoint ?? []).join("\n");
    expect(sql).toContain("pg_depend");
    expect(sql).toContain("d.deptype IN ('a', 'i')");
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

  it("keeps the profiled services out of its own default invocation", () => {
    // A profile is what stops `pnpm dev:up` from building and running these. The
    // assertion is that the overlay's plain config does not contain them at all,
    // which is stronger than checking the `profiles` key: it is the behaviour.
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

describe("managed portal theme plumbing (ADR-30, issue #499)", () => {
  it("names the variable on both apps, so Compose forwards it at all", () => {
    // The same failure shape as the two blocks around it, and silent in the
    // direction that matters: an operator sets QCMS_PORTAL_THEME, both apps fall
    // back to the base theme, and the deployment serves the wrong brand with no
    // error and a documentation page saying the variable works.
    //
    // Both apps or neither. docs/operations.md tells the operator to set the same
    // value in both services: the portal renders respondents in it and the admin
    // opens its question preview island in it, so forwarding it to one alone makes
    // an author's preview disagree with what the deployment actually serves.
    for (const name of ["portal", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the managed portal theme`,
      ).toHaveProperty("QCMS_PORTAL_THEME");
    }
  });

  it("leaves it empty by default, so each app applies its own documented fallback", () => {
    // Reachability, not a new default. Empty reads as unset, which is `slate` on the
    // portal and the admin's own preview default; picking a value here would make
    // Compose the one composition that overrides the app's default.
    //
    // Resolved with the variable forced empty rather than reusing `solo`, because
    // `composeConfig` inherits `process.env` and the browser harness exports this
    // variable (playwright.config.ts). A developer with it exported would otherwise
    // fail this test having changed nothing in the repo.
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: { QCMS_PORTAL_THEME: "" },
    });
    for (const name of ["portal", "admin"]) {
      expect(service(unset, name).environment?.QCMS_PORTAL_THEME).toBe("");
    }
  });

  it("keeps the theme off the API and the one-shot migration", () => {
    // Neither renders anything, so it is on the two app services rather than on the
    // `api-env` anchor those two share.
    for (const name of ["api", "migrate"]) {
      expect(service(solo, name).environment).not.toHaveProperty("QCMS_PORTAL_THEME");
    }
  });
});

/**
 * The rest of the portal's appearance group (issue #752).
 *
 * #499 was one knob; six more had the identical defect behind it, because the
 * portal's appearance is a GROUP, not a single setting. `apps/portal/lib/server/theme.ts`
 * reads seven `QCMS_PORTAL_*` variables, `apps/portal/.env.example`, `docs/theming.md`
 * and the `docs/operations.md` table document all seven, and before this the shipped
 * Compose file named exactly one of them. Setting the other six in `.env` reached
 * nothing, silently, with the documentation still saying they worked.
 *
 * The first test derives the list from the module rather than restating it, which is what
 * makes this a gate against the NEXT knob rather than a record of these seven. A regex
 * over source is a weak reader in general; here it is the right strength, because the
 * only thing it has to see is a literal `process.env.QCMS_PORTAL_*` read, which is the
 * one form that module uses and the one form Compose has to answer.
 */
describe("portal appearance-group plumbing (ADR-30, issue #752)", () => {
  /** Every `QCMS_PORTAL_*` variable `apps/portal/lib/server/theme.ts` actually reads. */
  const appearanceVars = (() => {
    const source = readFileSync(`${REPOSITORY_ROOT}/apps/portal/lib/server/theme.ts`, "utf8");
    const names = new Set<string>();
    for (const match of source.matchAll(/process\.env\.(QCMS_PORTAL_[A-Z0-9_]+)/gu)) {
      names.add(match[1]!);
    }
    return [...names].sort();
  })();

  it("reads the group off the portal's own config module, so the list cannot go stale", () => {
    // A sanity floor on the derivation itself: if the regex ever stops matching, every
    // assertion below would pass over an empty list and this block would certify nothing.
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
    // Reachability, not a new default, exactly as in the theme block above. Resolved with
    // every variable forced empty rather than reusing `solo`, because `composeConfig`
    // inherits `process.env` and the browser harness exports two of these
    // (playwright.config.ts sets QCMS_PORTAL_CORNERS and QCMS_PORTAL_FONTS).
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
    // The admin is the deliberate asymmetry. It takes QCMS_PORTAL_THEME because its
    // preview island opens in the deployment's respondent theme, and it reads none of
    // the rest: the authoring app's own chrome is never adopter-themeable (ADR-26), so
    // naming a brand mark or a font curation here would forward a value nothing in that
    // image reads. Asserted rather than left implicit, so "the admin takes the theme"
    // does not later get generalised into "the admin takes the appearance group".
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
    // Same failure shape as the OTLP block above, and found the same way: the
    // `QCMS_ADMIN_2FA=optional` escape hatch is documented in SECURITY_DESIGN.md,
    // DEVELOPER_GUIDE.md and operations.md, and is read by both processes - but
    // neither service named it here, so setting it in .env reached nothing and the
    // hatch could not be exercised against this stack at all.
    //
    // Both services or neither: the API decides whether an unenrolled session is
    // accepted and the admin decides whether the enrollment screen can be skipped,
    // so forwarding it to one alone makes every admin API call 401.
    for (const name of ["api", "admin"]) {
      expect(
        service(solo, name).environment,
        `${name} must forward the admin TOTP policy`,
      ).toHaveProperty("QCMS_ADMIN_2FA");
    }
  });

  it("defaults to required, so a stack started with nothing set enforces 2FA", () => {
    // The point of the passthrough is reachability, NOT a relaxed default. SEC-1 is
    // enforced by default in every environment, and SECURITY_DESIGN.md records why
    // no general-purpose signal (NODE_ENV, "it's local") may decide a security
    // control. Relaxing it stays an explicit per-stack opt-in.
    //
    // This resolves its OWN configuration with the variable forced empty rather than
    // reusing `solo`, because `composeConfig` inherits `process.env` and the
    // documented way to use the escape hatch on the `pnpm dev:portal` path is to
    // EXPORT this variable. A developer who did that would otherwise fail this test
    // with a message about the shipped default, having changed nothing in the repo.
    // Empty reads as unset to Compose's `:-`, which is exactly the case under test.
    const unset = composeConfig({
      files: ["docker-compose.yml"],
      env: { QCMS_ADMIN_2FA: "" },
    });
    for (const name of ["api", "admin"]) {
      expect(service(unset, name).environment?.QCMS_ADMIN_2FA).toBe("required");
    }
  });

  it("keeps the one-shot migration out of the auth policy", () => {
    // `migrate` shares the API's environment anchor; the policy is on the service
    // for the same reason the OTLP endpoint is. It serves no admin traffic.
    expect(service(solo, "migrate").environment).not.toHaveProperty("QCMS_ADMIN_2FA");
  });
});
