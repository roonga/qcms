/**
 * The operator commands that create and drop an environment (ADR-40, Q1, Q24, Q42).
 *
 * # Why this is a command and never an HTTP endpoint
 *
 * Creating an environment is **DDL**: a schema, seven tables, thirteen guards, seven
 * foreign keys, a view set, a role and its grants. No application role holds DDL and
 * none ever will (SEC-10), so this runs under the migration credential, from a shell,
 * by an operator - never by an administrator and never over HTTP. It is the shape
 * `qcms:reset-2fa` already uses, and it refuses the application credential by the same
 * test: **schema ownership**, not a role name, because a deployment that renamed its
 * roles would pass a name test connected as exactly the credential the guard exists
 * for.
 *
 * # The name is refused by three rules, not one (Q42)
 *
 * An environment's name is a URL path segment and a Postgres identifier at once, so:
 *
 *   1. it matches **`^[a-z][a-z0-9]*$`** - no hyphen, because an access-group name
 *      joins a set of environments with hyphens and `dev-test` has to read as two
 *      names; no underscore, because `data_<env>` and `reporting_<env>` join on one and
 *      `data_my_env` would be ambiguous about where the prefix ends;
 *   2. it is **length-checked against the longest identifier derived from it**, with
 *      the limit computed from the prefix list rather than written as a constant,
 *      because Postgres truncates an identifier over 63 bytes **silently** and two such
 *      names could then collide with each other with no error anywhere;
 *   3. it is not one of the **reserved** names of section 3.
 *
 * The refusal names the derived identifier that would not fit rather than quoting a
 * bare number, because an operator who has been refused needs to know what to shorten.
 *
 * **The combined-set ordering half of Q42 is task 069's.** This command creates one
 * environment at a time and never writes a set; 069's grant write path is what stores an
 * access-group name carrying one, normalises it on write and refuses an out-of-order
 * one.
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";
import {
  CONTROL_SCHEMA,
  ENVIRONMENT_NAME_PREFIXES,
  dataSchemaName,
  environmentRoleName,
  reportingSchemaName,
} from "../schema/schemas.js";

import {
  createEnvironmentStatements,
  dropEnvironmentStatements,
  grantEnvironmentStatements,
} from "./sql.js";

/** The character rule (Q42). */
export const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

/**
 * Postgres truncates an identifier longer than `NAMEDATALEN - 1` bytes, silently.
 * 63 with the default `NAMEDATALEN` of 64.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * The environment a drop may never remove (Q24).
 *
 * `prod` is also reserved as a *name* below, for a different reason: it is the
 * unprefixed address shape, so a prefixed `prod` would be a second spelling of one
 * thing. The two rules land on the same word and are not the same rule.
 */
export const UNDROPPABLE_ENVIRONMENT = "prod";

/**
 * Names the command refuses, derived from what each surface already serves at its root.
 *
 * `scripts/reserved-environment-names.test.ts` derives the same set from the portal's
 * route directory and the API's route table and fails when this list no longer covers
 * it, which is what keeps a hand-kept copy from going stale the first time somebody adds
 * a root route. The list lives here rather than being computed at run time because
 * `@roonga/qcms-db` cannot import either application.
 *
 * A few entries are already unreachable under the character rule - `link-error` carries
 * a hyphen, `_next` an underscore. They stay, because the set is derived from the routes
 * rather than filtered against another rule, and a derived set that quietly drops its
 * own members is a set somebody has to re-derive before they can trust it.
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
  // Task 065's. `GET /admin/environments` serves the live set to the admin's switcher,
  // and an environment named `environments` would make `/environments/...` two addresses.
  "environments",
  "releases",
  "health",
  "ready",
  "internal",
  "admin",
  "api",
  // The schema names (Q23). `data` would give `data_data`, which is legal and
  // unreadable; `control`, `reporting` or `public` would give `data_control` and the
  // like, which is worse, because the name then reads as though the schema held the
  // control plane.
  "data",
  "control",
  "reporting",
  "public",
  // The address rule itself: prod is the unprefixed shape, so a prefixed `prod` would be
  // a second spelling of one thing. Written as a literal rather than as
  // `UNDROPPABLE_ENVIRONMENT`, though the two are the same word: they are two different
  // rules that happen to land on it, and this list is read as data by
  // `scripts/reserved-environment-names.test.ts`, which checks it against the routes.
  "prod",
];

/**
 * The longest environment name that fits every identifier derived from it.
 *
 * **Derived from the prefix list, never written as a constant.** A literal goes stale
 * the first time somebody adds a longer prefix, and it goes stale *silently*, because a
 * too-generous limit fails only at the truncation it was meant to prevent. Task 067 adds
 * the per-(workspace, environment) reporting role's prefix here when it names one (Q26);
 * if that prefix is the longest, this number drops and nothing else changes.
 */
export function maxEnvironmentNameLength(): number {
  const longest = Math.max(...ENVIRONMENT_NAME_PREFIXES.map((prefix) => prefix.length));
  return MAX_IDENTIFIER_BYTES - longest;
}

/** The identifier the name is interpolated into that runs out of room first. */
function longestDerivedIdentifier(name: string): string {
  const prefixes = [...ENVIRONMENT_NAME_PREFIXES].sort((a, b) => b.length - a.length);
  return `${prefixes[0] ?? ""}${name}`;
}

/**
 * Why this name is refused, or `undefined` when it is acceptable.
 *
 * One string rather than a thrown error, so the CLI can print it and the tests can
 * assert on it without unwrapping.
 */
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
 * Whether the connected role owns the control plane, which is the SEC-10 guard.
 *
 * **Ownership rather than a role name**, exactly as `readConnectedRole` argues for the
 * break-glass: matching `current_user = 'qcms_app'` reads as a guard while asserting
 * nothing, because a deployment that named its roles differently would pass a name test
 * connected as the application credential. Ownership is the property the role split is
 * made of, and `pg_has_role(..., 'USAGE')` rather than an equality on the owner oid, so
 * membership in the owning role counts and a superuser passes.
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

/** The per-environment settings an operator may set when creating one (Q11). */
export interface EnvironmentSettings {
  /** Overrides the installation-wide challenge provider; `undefined` keeps it. */
  readonly challengeProvider?: string;
  /** Overrides `QCMS_DELIVERY_SNIPPET_TTL_MS`; `undefined` keeps it. */
  readonly deliverySnippetTtlMs?: number;
  /** Overrides `QCMS_OUTBOX_PAYLOAD_TTL_MS`; `undefined` keeps it. */
  readonly outboxPayloadTtlMs?: number;
}

/** What creating an environment produced, for the command to report. */
export interface CreatedEnvironment {
  readonly name: string;
  readonly schema: string;
  readonly reportingSchema: string;
  readonly role: string;
  readonly position: number;
}

/**
 * Create one environment: its schemas, its per-environment objects, its row in the live
 * set, its role's grants and its settings.
 *
 * **One transaction**, so a half-created environment is not a state an operator has to
 * clean up: Postgres runs DDL transactionally, which is the property that makes this
 * safe to retry after a failure.
 *
 * The **role** is created here only when a password is given, because a role that can
 * log in needs a credential and this command is the first place in the design that has
 * one to hand. Without a password the grants still land, guarded on the role existing -
 * so an operator who provisions roles their own way runs their provisioning first and
 * this second, exactly as the SEC-10 recipe already has them do.
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
      // `format(%I, %L)` rather than interpolation: the name has already passed the
      // character rule, and a credential must never be concatenated into SQL whatever
      // else is true of it.
      await tx.execute(sql`
        do $$ begin
          execute format('CREATE ROLE %I LOGIN PASSWORD %L',
            ${environmentRoleName(input.name)}, ${input.password});
        end $$;
      `);
    }

    // DDL cannot be parameterized: a schema, a table and a constraint name are
    // identifiers, and Postgres has no bind parameter for one. What makes these
    // statements safe is what they are BUILT from rather than how they are sent: every
    // identifier comes from `src/schema/data/`, which is source code, interpolated with
    // one environment name that has already passed `refuseEnvironmentName` above -
    // `^[a-z][a-z0-9]*$`, length-checked, and not reserved. There is no other input.
    for (const statement of createEnvironmentStatements(input.name)) {
      // check-security-hygiene: allow generated DDL over a name already refused unless it matches ^[a-z][a-z0-9]*$
      await tx.execute(sql.raw(statement));
    }
    // The grants, and the migrate-only revokes with them, so a role created here cannot
    // arrive holding `two_factor_resets` (Q40). Both are guarded on the role existing.
    for (const statement of grantEnvironmentStatements(input.name)) {
      // check-security-hygiene: allow generated GRANT statements over the same refused name
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

/** Why a drop was refused: the open forms and the session count, never a bare no. */
export interface DropRefusal {
  readonly reason: string;
  readonly openForms: readonly string[];
  readonly sessionCount: number;
}

/**
 * Drop an environment, narrowly (Q24 with Q43 and Q44).
 *
 * `prod` can **never** be dropped. A non-prod environment can be dropped **only when
 * every form in it is closed and it holds zero sessions**, and this refuses otherwise,
 * **naming the open forms and the session count** rather than reporting a bare refusal,
 * because an operator who has been refused needs to know what to do next. It **refuses
 * and never archives** (Q43): an archive would be this command silently editing state an
 * operator wrote.
 *
 * **The access-group half of the check is task 069's** (Q44), because a team carrying an
 * `environments` field exists only from then.
 *
 * ## Why the narrowness is the whole point
 *
 * `DROP SCHEMA ... CASCADE` would take the answer ledger **without passing the
 * `answers_reject_delete` trigger**, so a wider drop would be a third whole-session
 * deletion path and ADR-17 says there are two. Under this rule a drop can only ever
 * remove an empty schema, so no door is added. An operator empties a `dev` environment
 * through retention, which is a sanctioned door, and not by dropping the schema out from
 * under it.
 *
 * ## What "every form in it is closed" means before task 066
 *
 * The closed state is **per form and environment** from 066 (Q18); today `forms.status`
 * is installation-wide. So until then this reads the open forms that **hold sessions in
 * this environment**, which is the set an operator has to act on: a form with no data
 * here is not in this environment in any sense the drop cares about. When 066 lands, the
 * same query reads that environment's own closed state and the two halves stop
 * collapsing into one.
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
     where f.status = 'open'
     order by f.form_id
  `);
  const open = openForms.rows.map((row) => row.form_id);

  if (sessionCount > 0 || open.length > 0) {
    return {
      reason:
        `${name} cannot be dropped: it holds ${String(sessionCount)} session(s)` +
        (open.length > 0 ? ` and these forms are still open in it: ${open.join(", ")}` : "") +
        ". Close the forms and let retention empty the environment, then drop it.",
      openForms: open,
      sessionCount,
    };
  }

  await exec.transaction(async (tx) => {
    // Two `DROP SCHEMA` statements over a name that is a row in `control.environments`
    // and has passed the character rule; identifiers cannot be bound as parameters.
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
