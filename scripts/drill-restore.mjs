/**
 * The restore drill: destroy the database for real, restore it, and let the product
 * judge the result.
 *
 * Row counts alone would pass a restore whose auth tables came back unusable, so the
 * pre-dump administrator is checked by identity and a form published before the dump is
 * requested from the running portal. That check drives the RESPONDENT surface because the
 * two alternatives are controls working correctly: MFA enrolment is one-shot, and
 * `createInitialAdmin` closes as soon as one account exists (SEC-1).
 *
 * The `postgres` container keeps running and only the database inside it is dropped:
 * inside the dev container the suite reaches portal and admin through a loopback
 * forwarder holding the container IP addresses resolved at `up()`, so recreating either
 * would strand it and read as a restore bug.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { composeCapture, composeRun, credentialsPath, down, test, up } from "./compose-e2e.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";
import { assertPortSeatChosen, harnessPort } from "./ports.mjs";

const CONTAINER_DUMP = "/tmp/qcms-drill.dump.sql";

/**
 * The restore runs as this role because `pg_dump --no-owner` lands ownership on whoever
 * runs it, and SEC-10 expects it here. No password: `psql` in the container connects over
 * the Unix socket, which the official image leaves on initdb's `local all all trust`.
 */
const MIGRATE_ROLE = "qcms_migrate";

/**
/**
 * Read out of `control.environments` so an environment created after this shipped is
 * covered without a code change. A query rather than a `data_%` pattern, because an
 * environment whose row exists and whose schema does not is exactly the half-restored
 * database this drill looks for (ADR-40).
 *
 * @returns {string[]}
 */
function dataSchemas() {
  return schemasForEnvironments(
    psql([
      "--tuples-only",
      "--no-align",
      "--command",
      "select name from control.environments order by position;",
    ]),
  );
}

/**
 * @param {string} psqlOutput one environment name per line, in `position` order
 * @returns {string[]}
 */
export function schemasForEnvironments(psqlOutput) {
  const names = psqlOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (names.length === 0) {
    throw new Error(
      "drill-restore: control.environments is empty, so there is no environment to cover; " +
        "the stack never migrated or never seeded its environment set",
    );
  }
  return ["control", ...names.flatMap((name) => [`data_${name}`, `reporting_${name}`])];
}

/**
/**
 * Derived rather than a hand-written table list, so a table added later is still covered.
 * Views are counted beside tables because a restore that brought back every row and no
 * reporting view would look perfect and serve nothing. `query_to_xml` is the idiom for a
 * count over a dynamic relation name inside one query.
 *
 * @param {string[]} schemas
 * @returns {string}
 */
function fingerprint(schemas) {
  const list = schemas.map((name) => `'${name}'`).join(", ");
  const sql = `
    select table_schema || '.' || table_name || '=' || (
      xpath(
        '/row/c/text()',
        query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')
      )
    )[1]::text
    from information_schema.tables
    where table_schema in (${list}) and table_type in ('BASE TABLE', 'VIEW')
    order by table_schema, table_name;
  `;
  return psql(["--tuples-only", "--no-align", "--command", sql.replace(/\s+/g, " ").trim()]);
}

/**
 * Credentials come from the container's own `POSTGRES_*` environment, so the drill never
 * has to agree with `docker-compose.yml` about what the database is called.
 *
 * @param {string[]} args
 * @returns {string}
 */
function psql(args) {
  return composeCapture([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    `psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" ${args.map(shellQuote).join(" ")}`,
  ]);
}

/**
 * `--` comments must go first: collapsing newlines around one would swallow the rest of
 * the query into that comment and `psql` would run a truncated statement.
 *
 * @param {string} sql
 * @returns {string}
 */
function oneLine(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {string} */
export function privilegeMapSql() {
  return readFileSync(
    join(REPOSITORY_ROOT, "packages", "db", "privileges", "privilege-map.sql"),
    "utf8",
  );
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Not narrowed to a schema list, because this also runs after the drop, when
 * `control.environments` is gone and the question is whether anything of ours is left.
 *
 * @returns {number}
 */
function tableCount() {
  const out = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    "select count(*) from information_schema.tables where table_schema not in " +
      "('pg_catalog', 'information_schema') and table_type = 'BASE TABLE';",
  ]);
  return Number(out.trim());
}

/**
 * ADR-40 leaves `public` empty so an unqualified name can never resolve to something a
 * tool created there. A restore that landed QCMS's tables in `public` would work right up
 * to the first time something else wrote a `sessions` table.
 */
function assertPublicEmpty() {
  const left = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    "select count(*) from information_schema.tables where table_schema = 'public';",
  ]).trim();
  if (left !== "0") {
    throw new Error(
      `drill-restore: the restored database has ${left} object(s) in \`public\`, which ADR-40 ` +
        "leaves empty and off every search path",
    );
  }
}

/**
 * Through a file in the container rather than this process's stdio: a captured stdout
 * invites the whitespace and encoding trims that make a restore fail later.
 *
 * @param {string} hostPath
 */
function dumpTo(hostPath) {
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    `pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges > ${CONTAINER_DUMP}`,
  ]);
  composeRun(["cp", `postgres:${CONTAINER_DUMP}`, hostPath]);
}

/**
 * Connections are terminated first, because Postgres refuses to drop a database anything
 * is still connected to and the API holds a pool open. The API is restarted afterwards,
 * since a pool whose database vanished underneath it is what the restart clears.
 */
function destroyDatabase() {
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    [
      `psql --username "$POSTGRES_USER" --dbname postgres --command`,
      `"select pg_terminate_backend(pid) from pg_stat_activity where datname = '$POSTGRES_DB' and pid <> pg_backend_pid();"`,
      `&& dropdb --username "$POSTGRES_USER" "$POSTGRES_DB"`,
      `&& createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB"`,
      // `CREATE` is a privilege ON the database, so the drop destroyed it and the
      // one-shot that granted it runs at `up`, not here. Without this the restore cannot
      // create a schema. `docs/backup-restore.md` carries the same line.
      `&& psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --command`,
      `"GRANT CREATE ON DATABASE \\"$POSTGRES_DB\\" TO ${MIGRATE_ROLE};"`,
    ].join(" "),
  ]);
}

/** @param {string} hostPath */
function restoreFrom(hostPath) {
  composeRun(["cp", hostPath, `postgres:${CONTAINER_DUMP}`]);
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    // ON_ERROR_STOP is the difference between a restore that failed and a restore
    `psql --username ${MIGRATE_ROLE} --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on --file ${CONTAINER_DUMP}`,
  ]);
}

/**
 * @param {string} expected
 * @param {string} actual
 * @returns {string}
 */
function grantDifference(expected, actual) {
  const split = (text) => new Set(text.split("\n").filter((line) => line.trim() !== ""));
  const before = split(expected);
  const after = split(actual);
  const missing = [...before].filter((line) => !after.has(line)).sort();
  const extra = [...after].filter((line) => !before.has(line)).sort();
  return (
    `${String(missing.length)} missing, ${String(extra.length)} unexpected\n` +
    missing.map((line) => `  -${line}`).join("\n") +
    (missing.length > 0 && extra.length > 0 ? "\n" : "") +
    extra.map((line) => `  +${line}`).join("\n")
  );
}

/**
/**
 * `pg_dump --no-privileges` carries no grant and the drizzle journal rides inside the
 * dump, so a post-restore `migrate` re-applies nothing.
 *
 * `--no-deps` is load-bearing: without it Compose starts `db-roles`, which re-assigns
 * every schema's ownership and would make the assertions below vacuous.
 */
function regrant() {
  // `--no-TTY` because this runs from a script with no terminal and Compose allocates one
  // by default.
  composeRun(["run", "--rm", "--no-TTY", "--no-deps", "migrate", "qcms-db-environment", "regrant"]);
}

/**
/**
 * Asserted per environment from `control.environments`, so an operator-created one is
 * covered. Ownership is read for `reporting_<env>` too: left on the superuser it would
 * refuse the next `qcms-db-environment reporting` run.
 */
function assertRestoredGrants() {
  const rows = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    `select e.name
       || ' usage=' || has_schema_privilege('qcms_app_' || e.name, 'data_' || e.name, 'USAGE')
       || ' insert=' || has_table_privilege('qcms_app_' || e.name, 'data_' || e.name || '.sessions', 'INSERT')
       || ' reporting=' || has_schema_privilege('qcms_app_' || e.name, 'reporting_' || e.name, 'USAGE')
       || ' data_owner=' || (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'data_' || e.name)
       || ' reporting_owner=' || (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'reporting_' || e.name)
       || ' control_owner=' || (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'control')
      from control.environments e
      where exists (select 1 from pg_roles where rolname = 'qcms_app_' || e.name)
      order by e.position`,
  ]).trim();
  if (rows === "") {
    throw new Error(
      "drill-restore: no environment in `control.environments` has an application role, so " +
        "the grant assertions below would prove nothing",
    );
  }
  const problems = [];
  for (const row of rows.split("\n")) {
    if (!row.includes(" usage=t")) problems.push(`${row} (no USAGE on its data schema)`);
    if (!row.includes(" insert=t")) problems.push(`${row} (no INSERT on its sessions table)`);
    if (!row.includes(" reporting=t")) problems.push(`${row} (no USAGE on its reporting schema)`);
    if (!row.includes(` data_owner=${MIGRATE_ROLE}`)) problems.push(`${row} (data misowned)`);
    if (!row.includes(` reporting_owner=${MIGRATE_ROLE}`)) {
      problems.push(`${row} (reporting misowned)`);
    }
    if (!row.includes(` control_owner=${MIGRATE_ROLE}`)) problems.push(`${row} (control misowned)`);
  }
  // The re-grant cannot re-apply this: a REVOKE on a schema needs its owner, and a
  // database recreated by the restore owns `public` as `pg_database_owner`.
  const publicCreate = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    `select coalesce(bool_or(acl.privilege_type = 'CREATE' and acl.grantee = 0), false)
       from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
      where n.nspname = 'public'`,
  ]).trim();
  if (publicCreate !== "f") problems.push("PUBLIC still holds CREATE on schema public");
  // The same property per role, because `public` is out of the snapshot above (Q76) and
  const appCreate = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    `select coalesce(bool_or(has_schema_privilege(rolname, 'public', 'CREATE')), false)
       from pg_roles where rolname like 'qcms\\_app%'`,
  ]).trim();
  if (appCreate !== "f") problems.push("a qcms_app% role holds CREATE on schema public");
  if (problems.length > 0) {
    throw new Error(
      `drill-restore: the re-granted database is not what a migrated one holds:\n  ${problems.join("\n  ")}`,
    );
  }
  process.stdout.write(`drill-restore: re-granted and owned by ${MIGRATE_ROLE}:\n${rows}\n`);
}

/**
/**
 * Privileges every `qcms%` role effectively HOLDS, not what is stored: a `REVOKE` on a
 * relation whose ACL is NULL materialises an owner entry that never goes away, so a
 * stored-ACL reading reports a difference in a privilege nobody holds.
 *
 * Reads the `.sql` file rather than importing the built package, because a recovery drill
 * must not depend on `packages/db/dist` existing. `public` is excluded, since the
 * documented procedure recreates the database and its ownership genuinely changes; the
 * property that matters is asserted in {@link assertRestoredGrants}.
 *
 * @returns {string}
 */
function grantSnapshot() {
  return psql([
    "--tuples-only",
    "--no-align",
    "--command",
    oneLine(privilegeMapSql().replace("$1", "array['public']")),
  ]);
}

/**
 * Three separate facts because they fail separately: a dump that captured the account row
 * but not the two-factor enrolment leaves an account nobody can sign in as.
 *
 * Table names are better-auth's, quoted because `user` is reserved and `twoFactor` is
 * camel-cased.
 *
 * @param {string} email
 */
function assertAdminSurvived(email) {
  const counts = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    `select
       (select count(*) from control."user" where email = ${quoteSql(email)}),
       (select count(*) from control."account" a join control."user" u on a."userId" = u.id where u.email = ${quoteSql(email)}),
       (select count(*) from control."twoFactor" t join control."user" u on t."userId" = u.id where u.email = ${quoteSql(email)})`,
  ]);
  const [user, account, twoFactor] = counts.trim().split("|").map(Number);
  const problems = [];
  if (user !== 1) problems.push(`the account row is gone (found ${String(user)})`);
  if (account !== 1) problems.push(`the sign-in credential is gone (found ${String(account)})`);
  if (twoFactor !== 1) {
    problems.push(`the two-factor enrolment is gone (found ${String(twoFactor)})`);
  }
  if (problems.length > 0) {
    throw new Error(
      `drill-restore: the pre-dump administrator did not survive the restore:\n  ${problems.join("\n  ")}`,
    );
  }
  process.stdout.write(`drill-restore: ${email} survived with its credential and 2FA enrolment\n`);
}

/** @param {string} value */
function quoteSql(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
/**
 * Read back out of the restored database rather than remembered from before the dump,
 * which is the stronger direction: it proves the rows came back.
 *
 * @returns {{ slug: string, labels: string[] }}
 */
function readRestoredPublishedForm() {
  const slug = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    // `published_at` is NOT NULL here, so a row in `form_versions` IS a published version
    // and the join is the whole filter.
    `select f.slug from control.forms f
       join control.form_versions v on v.form_id = f.form_id
      order by v.published_at desc
      limit 1`,
  ]).trim();
  if (slug === "") {
    throw new Error(
      "drill-restore: the restored database has no published form, so the seeding run never got that far",
    );
  }
  const labelJson = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    // Every A2UI control carries `props.label`, and `$.**` walks any depth, so this gets
    // the visible text without the drill knowing the document's shape.
    `select jsonb_path_query_array(v.compiled, '$.**.label')
       from control.forms f
       join control.form_versions v on v.form_id = f.form_id
      where f.slug = ${quoteSql(slug)}
      order by v.published_at desc
      limit 1`,
  ]).trim();
  /** @type {unknown} */
  const parsed = JSON.parse(labelJson === "" ? "[]" : labelJson);
  // Short strings go because the same `label` prop names radio and checkbox children, and
  // matching on "Yes" would match a word any page might contain.
  const labels = (Array.isArray(parsed) ? parsed : []).filter(
    (value) => typeof value === "string" && value.length >= 4,
  );
  if (labels.length === 0) {
    throw new Error(
      `drill-restore: the restored compiled document for ${slug} carries no question label, so there is nothing to hold the served page against`,
    );
  }
  return { slug, labels: /** @type {string[]} */ (labels) };
}

/**
 * @param {string} html
 * @returns {string}
 */
function decodeEntities(html) {
  return html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/**
/**
 * Asserting a label from `form_versions.compiled` renders is what proves the restored
 * jsonb is what gets served (ADR-18, never a recompilation).
 *
 * `GET /f/:slug` is deliberately not used: it is static, takes no database and echoes its
 * own slug, so it answers 200 against a completely empty database.
 *
 * @param {string} slug
 * @param {string[]} labels
 */
export async function assertPortalServesRestoredForm(slug, labels) {
  const base = `http://localhost:${String(harnessPort("portal"))}`;
  // The portal's SEC-9 belt refuses a state-changing POST that declares no origin, and
  // node's `fetch` declares none, so without these headers the drill reports
  // `state=error` and reads as a failed restore. `Sec-Fetch-Site` is read first.
  const start = await fetch(`${base}/f/${slug}/start`, {
    method: "POST",
    redirect: "manual",
    headers: { "sec-fetch-site": "same-origin", origin: base },
  });
  if (start.status !== 303) {
    throw new Error(
      `drill-restore: POST /f/${slug}/start answered ${String(start.status)}, expected a 303 into the flow`,
    );
  }
  const target = new URL(start.headers.get("location") ?? "", base);
  const refused = target.searchParams.get("state");
  if (refused !== null) {
    // `state=error` is every refusal the entry route has no word for, and reading it as
    // missing data is the worst false alarm to raise during a recovery, so the portal's
    // own log goes in the message (SEC-8: ids and classifications only, no values).
    const portalLog = composeCapture(["logs", "--tail", "30", "portal"]);
    throw new Error(
      `drill-restore: the portal refused to start a session on the restored form ${slug} ` +
        `(state=${refused}). "notfound" means the form row did not come back, "closed" ` +
        `means no version is released to prod, and "error" is anything else - the portal's ` +
        `last 30 log lines follow.\n${portalLog}`,
    );
  }
  const sessionId = target.pathname.startsWith("/s/") ? target.pathname.slice(3) : "";
  if (sessionId === "") {
    throw new Error(
      `drill-restore: the portal redirected to ${target.pathname} rather than into a session`,
    );
  }
  // Replaying the httpOnly cookie the BFF set on the 303 is what makes the next request
  // the same respondent rather than a new visitor.
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (cookie === "") {
    throw new Error(
      `drill-restore: the portal started session ${sessionId} but issued no session cookie`,
    );
  }

  const step = await fetch(`${base}/s/${sessionId}`, { headers: { cookie } });
  const body = decodeEntities(await step.text());
  if (!step.ok) {
    throw new Error(
      `drill-restore: the portal answered ${String(step.status)} for the restored session ${sessionId}`,
    );
  }
  const served = labels.find((label) => body.includes(label));
  if (served === undefined) {
    throw new Error(
      `drill-restore: the step page for session ${sessionId} carries none of the ${String(labels.length)} question labels in the restored compiled document, so the portal served a recovery or error shell rather than the form`,
    );
  }
  process.stdout.write(
    `drill-restore: started session ${sessionId} on the pre-dump form ${slug} and the portal served its question ${JSON.stringify(served)} from the restored compilation\n`,
  );
}

/** @param {string} message */
function step(message) {
  process.stdout.write(`\ndrill-restore: ${message}\n`);
}

async function drill() {
  const workspace = mkdtempSync(join(tmpdir(), "qcms-drill-"));
  const hostDump = join(workspace, "qcms-drill.dump.sql");
  try {
    step("bringing up a fresh stack and bootstrapping an administrator");
    await up();
    // Read back from the credentials file the spec itself reads, so the drill checks the
    // same account the suite signed in as.
    const seededAdmin = JSON.parse(readFileSync(credentialsPath, "utf8"));

    step("seeding real domain data by running the full-stack suite");
    test();

    step("fingerprinting the seeded database, one schema per environment in the live set");
    // Read BEFORE the drop, which is the only moment it can be read at all: the table
    // goes with the database.
    const schemas = dataSchemas();
    process.stdout.write(`drill-restore: covering ${schemas.join(", ")}\n`);
    const before = fingerprint(schemas);
    const seededTables = tableCount();
    if (seededTables === 0) {
      throw new Error("drill-restore: the seeded database has no tables; the stack never migrated");
    }
    // The whole grant map rather than the privileges this script expected: the re-grant
    // must restore exactly what a migrated database holds and widen nothing.
    const grantsBefore = grantSnapshot();
    process.stdout.write(`${before}\n`);

    step(`dumping to ${hostDump}`);
    dumpTo(hostDump);

    step("destroying the database");
    destroyDatabase();
    const emptied = tableCount();
    if (emptied !== 0) {
      throw new Error(
        `drill-restore: the database still has ${String(emptied)} tables after the drop, so the restore below would prove nothing`,
      );
    }

    step(`restoring from the dump, as ${MIGRATE_ROLE}`);
    restoreFrom(hostDump);

    step("re-applying the grant model, which the dump deliberately does not carry");
    // The assertion before it is what makes this evidence rather than ritual: the restored
    // database must NOT hold the application grants yet, so a no-op re-grant cannot pass.
    const grantsAfterRestore = grantSnapshot();
    if (grantsAfterRestore === grantsBefore) {
      throw new Error(
        "drill-restore: the restored database already holds every grant, so this step " +
          "proves nothing. Either `--no-privileges` was dropped from the dump flags or " +
          "something re-granted behind the drill (check that `regrant` runs with --no-deps, " +
          "so Compose does not re-run the `db-roles` one-shot)",
      );
    }
    regrant();
    assertRestoredGrants();
    const grantsAfterRegrant = grantSnapshot();
    if (grantsAfterRegrant !== grantsBefore) {
      throw new Error(
        "drill-restore: the re-granted database does not hold the pre-dump grant map.\n" +
          grantDifference(grantsBefore, grantsAfterRegrant),
      );
    }
    // Run twice, so an operator re-running a recovery script cannot widen anything.
    regrant();
    const grantsAfterSecond = grantSnapshot();
    if (grantsAfterSecond !== grantsBefore) {
      throw new Error(
        "drill-restore: running the re-grant a second time changed the grant map.\n" +
          grantDifference(grantsBefore, grantsAfterSecond),
      );
    }
    process.stdout.write("drill-restore: the grant map matches the pre-dump one, twice over\n");

    step("restarting the API so it reconnects to the restored database");
    composeRun(["up", "--detach", "--wait", "api"]);

    step("comparing the restored fingerprint against the pre-dump one");
    // Derived again rather than reused: a restore that brought back a different
    // environment set must fail on that, not on a count taken over whichever set came back.
    const restoredSchemas = dataSchemas();
    if (restoredSchemas.join(", ") !== schemas.join(", ")) {
      throw new Error(
        "drill-restore: the restored database's environment set is not the one that was " +
          `dumped.\nbefore: ${schemas.join(", ")}\nafter:  ${restoredSchemas.join(", ")}`,
      );
    }
    const after = fingerprint(restoredSchemas);
    if (after !== before) {
      throw new Error(
        `drill-restore: the restored database does not match the dump.\nbefore:\n${before}\nafter:\n${after}`,
      );
    }
    process.stdout.write(`${after}\n`);
    // A restore that landed the tables in `public` would pass every count above.
    assertPublicEmpty();

    step("checking the pre-dump administrator survived the restore");
    // Row counts match whether or not the auth tables came back usable, so the pre-dump
    // account is checked by identity.
    assertAdminSurvived(seededAdmin.email);

    step("answering a pre-dump form from the restored database, through the portal");
    // The API restart two steps ago also reset the in-memory rate-limit store the seeding
    // run drew down; without it this session start could be 429'd and read as a failed
    // restore.
    const restored = readRestoredPublishedForm();
    await assertPortalServesRestoredForm(restored.slug, restored.labels);

    step("PASSED: the dump restored and the product works on top of it");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  assertPortSeatChosen(REPOSITORY_ROOT, "pnpm qcms:drill-restore");
  /** @type {unknown} */
  let failure;
  try {
    await drill();
  } catch (error) {
    failure = error;
  }
  try {
    down();
  } catch (error) {
    if (failure === undefined) failure = error;
    else process.stderr.write(`drill-restore: teardown also failed: ${String(error)}\n`);
  }
  if (failure !== undefined) throw failure;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.exitCode = 1;
    process.stderr.write(
      `drill-restore: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  });
}
