/**
 * `qcms-db-environment regrant` - re-apply the whole grant model (issue #1094).
 *
 * # The defect this exists for
 *
 * `docs/backup-restore.md` dumps with `pg_dump --clean --if-exists --no-owner
 * --no-privileges`, and the Code Owner's ruling of 2026-10-22 keeps `--no-privileges`:
 * a dump that named roles would couple the backup to one deployment's role names and
 * stop being portable. The consequence is that the dump carries **no grant at all** -
 * measured, not inferred: zero `GRANT` or `REVOKE` lines against the 39 in
 * `migrations/0000_environments_baseline.sql`.
 *
 * The usual repair, "run the migration again", cannot work either: drizzle's journal is
 * a table inside the dump, so a restored database already reports every migration
 * applied and `qcms-db-migrate` re-applies nothing. Since task 064 put every application
 * grant in the baseline, a restored database therefore came back with `qcms_app_prod`
 * holding no `USAGE` on `data_prod` and no `INSERT` on `data_prod.sessions`, and the
 * first respondent write answered 500. The restore drill never reached that far, because
 * it counted tables in `public`, which ADR-40 leaves empty.
 *
 * So the restore procedure gains one step, and this is it.
 *
 * # What it applies, and why it is not a second copy of the model
 *
 * Everything in {@link GRANT_SOURCES}, in that order, for every environment in
 * `control.environments`. That list is the same set of generator functions the baseline
 * and the environment command call, which is the ruling's central requirement: there is
 * no hand-maintained second copy, and `grants.test.ts` fails if a `GRANT` or a `REVOKE`
 * appears anywhere in the migration tree that the list does not produce.
 *
 * It therefore **cannot widen privilege**: the statements are the migrations' own bytes,
 * so the set of privileges this can produce is exactly the set a migrated database holds.
 * `apps/api/e2e/security/04-db-restore-regrant.e2e.ts` proves that against a real
 * catalogue by comparing the complete grant map before the dump and after the re-grant
 * for equality, rather than checking that each expected privilege is present.
 *
 * # Which credential, and what it needs
 *
 * **The migration credential** (`qcms_migrate`), the same one `qcms-db-migrate` and the
 * other environment subcommands use, and the refusal is the same ownership test rather
 * than a role name (`ownsControlSchema` in `./command.ts`, which this module does not
 * import). What Postgres requires of it:
 *
 *   - **ownership of `control`, each `data_<env>` and each `reporting_<env>`**, because
 *     only an owner may `GRANT` on an object. A restore run as `qcms_migrate` lands
 *     ownership there, which is why the procedure says to restore as that role;
 *   - **nothing else**. No `CREATEROLE` (the roles are the operator's to create, as the
 *     baseline's header argues), no `SUPERUSER`, no ownership of the database.
 *
 * # Never the statement, in any error path (SEC-8)
 *
 * drizzle wraps a failed statement in a `DrizzleQueryError` whose message is `Failed
 * query: <sql>\nparams: <params>`, and `environment-cli.ts`'s `describeError` **unwraps a
 * cause** into the line it writes to stderr. So a wrapper that rethrows with `{ cause }`
 * puts the whole statement on an operator's terminal, which is what the first version of
 * this module did and what PR #1099's review reproduced: the full `DO $$ ... GRANT ...`
 * reached stderr right after the sentence saying it would not.
 *
 * Every statement therefore runs inside {@link refuseWithoutStatement}, task 067's wrapper
 * from `./role.ts`, which attaches **no** cause and repeats the **driver's** own complaint
 * (`cause.cause.message`, "permission denied for schema data_prod") rather than drizzle's.
 * That is the part that is safe to print and the part that tells an operator what to do.
 * One wrapper and not two, for the reason the grant generators are one copy and not two.
 *
 * **Every database call in this module, not only the statements.** The first version
 * wrapped the `GRANT`s and left three reads bare - the live-set read, 067's workspace
 * reads and the `public` probe - and PR #1099's round-2 review falsified the sentence
 * above in one command by renaming `control.environments`:
 *
 * ```
 * qcms-db environment failed: Failed query: select "name" from "control"."environments" ...
 * ```
 *
 * None of those three can carry a credential: each is a fixed query over no input. The
 * narrower sentence would have been true, and the review said so. They are wrapped
 * anyway, because a claim an operator can falsify by reading one error message is worth
 * less than the property it describes, and because the next read added here will be
 * written in the shape the ones around it already have.
 *
 * No grant statement carries a credential today either. The discipline is applied for the
 * same reason: a generator that one day emits a `CREATE ROLE ... PASSWORD` must not be the
 * thing that discovers this, and 067's `role.ts` is the proof that it happens.
 * `regrant.integration.test.ts` asserts the thrown message **and** what reaches stderr
 * through `describeError`, on both a failing statement and a failing read - the layer the
 * leak was in, which is why the assertion is there and not only on the wrapper.
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";
import { CONTROL_SCHEMA } from "../schema/schemas.js";

import { listEnvironmentNames } from "../queries/grants.js";

import { type GrantPass, UNREAPPLIABLE_SOURCES, regrantPasses } from "./grants.js";
import { refuseWithoutStatement } from "./role.js";

/** What a re-grant did, for the command to report and for a test to assert on. */
export interface RegrantReport {
  /** The live set, in `control.environments.position` order. */
  readonly environments: readonly string[];
  /** One row per source pass, in execution order, with how many statements it carried. */
  readonly passes: readonly {
    readonly source: string;
    readonly environment?: string;
    readonly statements: number;
  }[];
  /** How many statements were executed in total. */
  readonly statements: number;
  /**
   * Whether `CREATE` on `public` is still granted to `PUBLIC`.
   *
   * The one part of the model a re-grant cannot re-apply ({@link UNREAPPLIABLE_SOURCES}),
   * so it is **measured and reported** instead of being left unsaid. `true` is a finding
   * an operator has to act on with a superuser; on PostgreSQL 15 and later a freshly
   * created database makes it `false` with nothing done.
   */
  readonly publicCreateGrantedToPublic: boolean;
}

/**
 * What a refusal calls the pass that failed: the source's name and the environment, and
 * nothing of the statement (SEC-8).
 *
 * The subject {@link refuseWithoutStatement} prints after "could not re-apply".
 */
function passSubject(pass: GrantPass): string {
  const where = pass.environment === undefined ? "" : ` for environment ${pass.environment}`;
  return `${pass.source}${where}`;
}

/**
 * Whether `PUBLIC` still holds `CREATE` on `public`.
 *
 * `aclexplode` rather than `has_schema_privilege`: the pseudo-role `PUBLIC` is grantee
 * oid `0` and is not a name that function accepts, and asking per role would answer a
 * different question - every role holds what `PUBLIC` holds, so a per-role read cannot
 * tell a grant to `PUBLIC` apart from a grant to the role.
 */
async function publicCreateGrantedToPublic(exec: Executor): Promise<boolean> {
  const result = await exec.execute<{ granted: boolean }>(sql`
    select coalesce(bool_or(acl.privilege_type = 'CREATE' and acl.grantee = 0), false) as granted
      from pg_catalog.pg_namespace n,
           aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) as acl
     where n.nspname = 'public'
  `);
  return result.rows[0]?.granted ?? false;
}

/**
 * Re-apply every grant and revoke in the model, for every environment in the live set.
 *
 * **One transaction**, for the reason `createEnvironment` uses one: a half-applied grant
 * model is a state an operator would have to reason about, and Postgres applies `GRANT`
 * transactionally, so a failure leaves the database exactly as it was and the command is
 * safe to retry.
 *
 * Idempotent, and that is a property of the statements rather than of a guard: a `GRANT`
 * sets a privilege rather than adding one, so running this twice is the same as running
 * it once, and running it against a database that is already correct changes nothing at
 * all. `04-db-restore-regrant.e2e.ts` asserts both against a real catalogue.
 */
export async function regrantEnvironments(exec: Executor): Promise<RegrantReport> {
  // `queries/grants.ts`'s own helper, not a second copy of the same `order by position`
  // read (PR #1099's review, finding 2). It is the query three API handlers already call.
  //
  // Wrapped for the same reason the statements are, even though this one is a fixed
  // `select` over no input and so can never carry a credential: an unwrapped read hands
  // drizzle's `Failed query: <sql>` straight to `describeError`, which made this module's
  // "never a statement, in any error path" sentence falsifiable in one command (PR
  // #1099's round-2 review, finding 1, measured with `control.environments` renamed).
  const environments = await refuseWithoutStatement(
    "read",
    `the live environment set from ${CONTROL_SCHEMA}.environments`,
    () => listEnvironmentNames(exec),
  );
  if (environments.length === 0) {
    throw new Error(
      `${CONTROL_SCHEMA}.environments is empty, so there is no environment to grant for. ` +
        "A restored database carries the live set inside the dump; an empty one means the " +
        "restore did not land the control plane",
    );
  }

  // The reads 067's reporting source makes happen here, before the transaction below, so
  // the transaction holds statements only. Wrapped as one unit rather than per source:
  // what a failure here tells an operator is that the model could not be assembled, and
  // the source that failed is named by the pass the refusal would have carried.
  const passes = await refuseWithoutStatement(
    "read",
    `the grant model for ${environments.join(", ")}`,
    () => regrantPasses(exec, environments),
  );
  await exec.transaction(async (tx) => {
    for (const pass of passes) {
      for (const statement of pass.statements) {
        // DDL-shaped statements cannot be parameterized, and what makes these safe is what
        // they are BUILT from: every one is a generator's output over an environment name
        // that is a row in `control.environments` and passed `refuseEnvironmentName` when
        // it was created, and over a workspace slug 067's own generator refuses unless it
        // matches `WORKSPACE_SLUG_PATTERN`. There is no other input.
        await refuseWithoutStatement("re-apply", passSubject(pass), () =>
          // check-security-hygiene: allow generated GRANT statements over names from control.environments
          tx.execute(sql.raw(statement)),
        );
      }
    }
  });

  return {
    environments,
    passes: passes.map((pass) => ({
      source: pass.source,
      ...(pass.environment === undefined ? {} : { environment: pass.environment }),
      statements: pass.statements.length,
    })),
    statements: passes.reduce((total, pass) => total + pass.statements.length, 0),
    publicCreateGrantedToPublic: await refuseWithoutStatement(
      "read",
      "whether PUBLIC still holds CREATE on the public schema",
      () => publicCreateGrantedToPublic(exec),
    ),
  };
}

/** The one-line note the command prints about what it deliberately did not re-apply. */
export function unreappliedNote(): string {
  return UNREAPPLIABLE_SOURCES.map((source) => `  not re-applied: ${source.name} - ${source.why}`)
    .join("\n")
    .concat("\n");
}
