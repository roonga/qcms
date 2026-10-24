import { sql } from "drizzle-orm";

import { accessGroupFullName } from "../access-groups.js";
import type { Executor } from "../queries/executor.js";
import { listGroupsNamingEnvironment } from "../queries/grants.js";
import {
  CONTROL_SCHEMA,
  ENVIRONMENT_NAME_PREFIXES,
  dataSchemaName,
  environmentRoleName,
  reportingSchemaName,
} from "../schema/schemas.js";

import { workspaceReportingStatementsForEnvironment } from "./reporting.js";
import { createLoginRole } from "./role.js";
import {
  createEnvironmentStatements,
  dropEnvironmentStatements,
  grantEnvironmentStatements,
} from "./sql.js";

/**
 * No hyphen, because an access-group name joins a set of environments with hyphens; no
 * underscore, because `data_<env>` joins on one and `data_my_env` would be ambiguous.
 */
export const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

/** Postgres truncates an identifier over `NAMEDATALEN - 1` bytes silently. */
const MAX_IDENTIFIER_BYTES = 63;

/** The one environment a drop may never remove. */
export const UNDROPPABLE_ENVIRONMENT = "prod";

/**
 * Each collides with a route, a schema name or the `prod` address shape. Hand-kept
 * because `@roonga/qcms-db` cannot import either application;
 * `scripts/reserved-environment-names.test.ts` fails when this list stops covering them.
 */
export const RESERVED_ENVIRONMENT_NAMES: readonly string[] = [
  // Portal root segments (`apps/portal/app`), plus Next's own.
  "f",
  "s",
  "l",
  "appearance",
  "done",
  "expired",
  "link-error",
  "_next",
  // API route paths and mount prefixes (`apps/api/src`).
  "forms",
  "questions",
  "sessions",
  "erasures",
  "outbox",
  "environments",
  "releases",
  "workspaces",
  "me",
  "health",
  "ready",
  "internal",
  "admin",
  "api",
  // The schema names, which the `data_<env>` prefix would make ambiguous.
  "data",
  "control",
  "reporting",
  "public",
  // A literal rather than `UNDROPPABLE_ENVIRONMENT`: the same word, a different rule.
  "prod",
];

/**
 * Derived from the prefix list rather than written as a constant: a too-generous literal
 * fails only at the silent truncation it was meant to prevent.
 */
export function maxEnvironmentNameLength(): number {
  const longest = Math.max(...ENVIRONMENT_NAME_PREFIXES.map((prefix) => prefix.length));
  return MAX_IDENTIFIER_BYTES - longest;
}

function longestDerivedIdentifier(name: string): string {
  const prefixes = [...ENVIRONMENT_NAME_PREFIXES].sort((a, b) => b.length - a.length);
  return `${prefixes[0] ?? ""}${name}`;
}

/** Why this name is refused, or `undefined` when it is acceptable. */
export function refuseEnvironmentName(name: string): string | undefined {
  if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
    return (
      `${name} is not a valid environment name: it must match ${ENVIRONMENT_NAME_PATTERN.source} ` +
      "- lowercase letters and digits, starting with a letter, with no hyphen and no underscore"
    );
  }
  if (Buffer.byteLength(name, "utf8") > maxEnvironmentNameLength()) {
    const derived = longestDerivedIdentifier(name);
    return (
      `${name} is too long: it would be interpolated into ${derived}, which is ` +
      `${String(Buffer.byteLength(derived, "utf8"))} bytes and Postgres silently ` +
      `truncates an identifier over ${String(MAX_IDENTIFIER_BYTES)}`
    );
  }
  if (RESERVED_ENVIRONMENT_NAMES.includes(name)) {
    return `${name} is reserved: it collides with a route, a schema name or the prod address shape`;
  }
  return undefined;
}

/**
 * The SEC-10 guard. Ownership rather than a role name, because a deployment that renamed
 * its roles would pass a name test; `pg_has_role` rather than an equality on the owner
 * oid, so membership in the owning role counts and a superuser passes.
 */
export async function ownsControlSchema(exec: Executor): Promise<{
  readonly role: string;
  readonly owns: boolean;
}> {
  const result = await exec.execute<{ role: string; owns: boolean }>(sql`
    select
      current_user::text as role,
      coalesce(bool_or(pg_catalog.pg_has_role(n.nspowner, 'USAGE')), false) as owns
    from pg_catalog.pg_namespace n
    where n.nspname = ${CONTROL_SCHEMA}
  `);
  const row = result.rows[0];
  return { role: row?.role ?? "unknown", owns: row?.owns ?? false };
}

/** Each overrides an installation-wide value; `undefined` keeps it. */
export interface EnvironmentSettings {
  readonly challengeProvider?: string;
  /** Overrides `QCMS_DELIVERY_SNIPPET_TTL_MS`. */
  readonly deliverySnippetTtlMs?: number;
  /** Overrides `QCMS_OUTBOX_PAYLOAD_TTL_MS`. */
  readonly outboxPayloadTtlMs?: number;
}

/** The names a created environment got, for the command to report. */
export interface CreatedEnvironment {
  readonly name: string;
  readonly schema: string;
  readonly reportingSchema: string;
  readonly role: string;
  readonly position: number;
}

/**
 * Without a password no role is created, but the grants still land, guarded on the role
 * existing, for an operator who provisions roles their own way.
 */
export async function createEnvironment(
  exec: Executor,
  input: {
    readonly name: string;
    readonly password?: string;
    readonly settings?: EnvironmentSettings;
  },
): Promise<CreatedEnvironment> {
  const refusal = refuseEnvironmentName(input.name);
  if (refusal !== undefined) throw new Error(refusal);

  const existing = await exec.execute<{ name: string }>(
    sql`select name from ${sql.identifier(CONTROL_SCHEMA)}.environments where name = ${input.name}`,
  );
  if (existing.rows.length > 0) throw new Error(`environment ${input.name} already exists`);

  return exec.transaction(async (tx) => {
    if (input.password !== undefined) {
      await createLoginRole(tx, environmentRoleName(input.name), input.password);
    }

    // DDL cannot be parameterized. What makes these safe is what they are built from:
    // every identifier comes from `src/schema/data/`, interpolated with one environment
    // name that passed `refuseEnvironmentName` above. There is no other input.
    for (const statement of createEnvironmentStatements(input.name)) {
      // check-security-hygiene: allow generated DDL over a name already refused unless it matches ^[a-z][a-z0-9]*$
      await tx.execute(sql.raw(statement));
    }
    for (const statement of grantEnvironmentStatements(input.name)) {
      // check-security-hygiene: allow generated GRANT statements over the same refused name
      await tx.execute(sql.raw(statement));
    }
    // Emitted here as well as in the reconciliation: there is no `ALTER DEFAULT
    // PRIVILEGES` in this design, so a new environment would otherwise lack these.
    for (const statement of await workspaceReportingStatementsForEnvironment(tx, input.name)) {
      // check-security-hygiene: allow generated DDL over a slug and an environment name already refused
      await tx.execute(sql.raw(statement));
    }

    const inserted = await tx.execute<{ position: number }>(sql`
      insert into ${sql.identifier(CONTROL_SCHEMA)}.environments
        ("name", "position", "challenge_provider", "delivery_snippet_ttl_ms", "outbox_payload_ttl_ms")
      select
        ${input.name},
        coalesce(max("position"), 0) + 1,
        ${input.settings?.challengeProvider ?? null},
        ${input.settings?.deliverySnippetTtlMs ?? null},
        ${input.settings?.outboxPayloadTtlMs ?? null}
      from ${sql.identifier(CONTROL_SCHEMA)}.environments
      returning "position"
    `);

    return {
      name: input.name,
      schema: dataSchemaName(input.name),
      reportingSchema: reportingSchemaName(input.name),
      role: environmentRoleName(input.name),
      position: inserted.rows[0]?.position ?? 0,
    };
  });
}

/** Why a drop was refused, naming every blocker rather than a bare no. */
export interface DropRefusal {
  readonly reason: string;
  readonly openForms: readonly string[];
  readonly sessionCount: number;
  /**
   * The database already refuses this drop: `control.form_releases.environment` is a
   * foreign key into `control.environments` and the history rejects DELETE. Counting the
   * rows turns a constraint violation into a refusal that says what happened.
   */
  readonly releaseCount: number;
  /** The derived `<workspace>.<team>`, never a stored name. */
  readonly accessGroups: readonly string[];
}

/**
 * The narrowness is a safety constraint: `DROP SCHEMA ... CASCADE` over a populated schema
 * would take the answer ledger without passing the `answers_reject_delete` trigger, a
 * third whole-session deletion path where ADR-17 allows two.
 *
 * A group scoped to `all` does not block, since `all` names no environment.
 */
export async function dropEnvironment(
  exec: Executor,
  name: string,
): Promise<DropRefusal | undefined> {
  if (name === UNDROPPABLE_ENVIRONMENT) {
    return {
      reason: `${UNDROPPABLE_ENVIRONMENT} can never be dropped`,
      openForms: [],
      sessionCount: 0,
      releaseCount: 0,
      accessGroups: [],
    };
  }

  const exists = await exec.execute<{ name: string }>(
    sql`select name from ${sql.identifier(CONTROL_SCHEMA)}.environments where name = ${name}`,
  );
  if (exists.rows.length === 0) throw new Error(`environment ${name} does not exist`);

  const schema = sql.identifier(dataSchemaName(name));
  const sessions = await exec.execute<{ count: number }>(
    sql`select count(*)::int as count from ${schema}.sessions`,
  );
  const sessionCount = sessions.rows[0]?.count ?? 0;

  const openForms = await exec.execute<{ form_id: string }>(sql`
    select distinct f.form_id
      from ${sql.identifier(CONTROL_SCHEMA)}.forms f
      join ${schema}.sessions s on s.form_id = f.form_id
     where exists (
             select 1
               from ${sql.identifier(CONTROL_SCHEMA)}.form_releases r
              where r.form_id = f.form_id
                and r.environment = ${name}
                and r.sequence = (
                      select max(r2.sequence)
                        from ${sql.identifier(CONTROL_SCHEMA)}.form_releases r2
                       where r2.form_id = f.form_id
                         and r2.environment = ${name})
                and r.closed = false)
     order by f.form_id
  `);
  const open = openForms.rows.map((row) => row.form_id);

  // Counted only so the refusal is legible; see `DropRefusal.releaseCount`.
  const releases = await exec.execute<{ count: number }>(
    sql`select count(*)::int as count
          from ${sql.identifier(CONTROL_SCHEMA)}.form_releases
         where environment = ${name}`,
  );
  const releaseCount = releases.rows[0]?.count ?? 0;

  const naming = await listGroupsNamingEnvironment(exec, name);
  const groups = naming.map((group) => accessGroupFullName(group.workspaceSlug, group.name));

  if (sessionCount > 0 || open.length > 0 || releaseCount > 0 || groups.length > 0) {
    // Every blocker, not the first: one of them is unrepairable, so reporting only a
    // repairable one would send somebody to do work that cannot help.
    const reasons: string[] = [];
    if (sessionCount > 0 || open.length > 0) {
      reasons.push(
        `it holds ${String(sessionCount)} session(s)` +
          (open.length > 0 ? ` and these forms are still open in it: ${open.join(", ")}` : "") +
          ". Close the forms and let retention empty the environment, then drop it",
      );
    }
    if (releaseCount > 0) {
      reasons.push(
        `${String(releaseCount)} release record(s) name it, and the release history is ` +
          "append-only, so there is no door to remove them: an environment anything was " +
          "ever released to cannot be dropped",
      );
    }
    if (groups.length > 0) {
      reasons.push(
        `these access groups name it in their scope: ${groups.join(", ")}. ` +
          "Remove or re-scope them first; the drop refuses rather than silencing a grant " +
          "somebody wrote",
      );
    }
    return {
      reason: `${name} cannot be dropped: ${reasons.join("; and ")}.`,
      openForms: open,
      sessionCount,
      releaseCount,
      accessGroups: groups,
    };
  }

  await exec.transaction(async (tx) => {
    for (const statement of dropEnvironmentStatements(name)) {
      // check-security-hygiene: allow DROP SCHEMA over a name read from control.environments
      await tx.execute(sql.raw(statement));
    }
    await tx.execute(
      sql`delete from ${sql.identifier(CONTROL_SCHEMA)}.environments where name = ${name}`,
    );
  });
  return undefined;
}
