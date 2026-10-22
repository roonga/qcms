# Backup and restore

Postgres is the only durable state QCMS has. The containers are disposable, the
images are rebuildable, and the secrets live in the operator's environment. So the
whole of this document is about one database, and the one claim worth making about
it: **a backup nobody has restored is not a backup, it is a file.**

That claim is why the restore procedure below has a script behind it
(`pnpm qcms:drill-restore`) that runs on a schedule in CI rather than sitting here as
an instruction someone will follow for the first time during an incident.

## What is in scope

| State                                          | Where it lives                      | Backed up by        |
| ---------------------------------------------- | ----------------------------------- | ------------------- |
| Forms, versions, responses, answers, sessions  | Postgres                            | `pg_dump`           |
| Administrator accounts and two-factor material | Postgres                            | `pg_dump`           |
| Outbox and delivery history                    | Postgres                            | `pg_dump`           |
| Erasure tombstones (compliance evidence)       | Postgres                            | `pg_dump`           |
| Signing and encryption keys                    | the environment, never the database | **you**, separately |
| Built images                                   | a registry, or rebuilt from a tag   | not backed up       |

The last two rows are the ones that bite.

**One database, several schemas, and a backup covers all of them** (ADR-40). The control
plane is `control`, each environment has a `data_<env>` holding its sessions, answers,
submissions, tombstones, outbox and endpoints, and each has a `reporting_<env>` holding the
views a BI tool reads. `public` is left **empty** and is on no search path. Nothing about
the dump changes for that: `pg_dump` of the one database takes every schema, so a backup is
whole or it is not a backup. What does change is what a **restore** has to be checked
against, and the drill below checks `control` plus every environment in the live set rather
than one list of tables (task 067, criterion 2).

**Keys are not in the dump, and a dump is useless without them.** `QCMS_APP_KEY`
encrypts webhook signing secrets at rest (SEC-6), so a database restored alongside a
different `QCMS_APP_KEY` comes back with those secrets undecryptable, and deliveries
fail with `secret_decrypt_failed` until they are re-issued. **That much is
recoverable without the old key**, and it is worth knowing before you conclude the
restore is lost: a webhook secret is server-generated, so pressing "Rotate secret" on
each form's Webhooks page mints a fresh one under the current key without reading the
old ciphertext. What it costs is handing every webhook consumer a new secret, not the
data. The step-by-step is the "App encryption key" section of `docs/operations.md`.
`QCMS_ADMIN_AUTH_SECRET` is the one that protects **stored two-factor material** -
both the TOTP secret and the recovery codes, which are encrypted under it (this
paragraph used to attribute that to `QCMS_APP_KEY`, and to say the codes were stored
in plaintext; neither was true - issue #319). Losing it locks every administrator out
of 2FA on a restored database, and nothing resets 2FA today (issue #432). Back the key
material up with the same care and the same schedule as the database, and store it
somewhere the database dump is not, so one compromise is not both.

Changing that secret deliberately is a different matter and is no longer a break: the
versioned `QCMS_ADMIN_AUTH_SECRETS` list keeps the old key readable while the new one
encrypts, so a restore can be brought forward onto a new key rather than stranded on a
lost one. The runbook, including what does and does not migrate on its own, is in
`docs/operations.md`.

`QCMS_LINK_KEYS` and `QCMS_SESSION_KEYS` are less severe: losing them invalidates
outstanding secure links and respondent sessions, which is a disruption rather than
a data loss. Rotation for all of these is in `docs/operations.md`.

## Taking a backup

The Compose topology publishes no database port (ADR-20), so the dump runs inside the
container:

```bash
docker compose exec -T postgres \
  sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         --clean --if-exists --no-owner --no-privileges' \
  > qcms-$(date -u +%Y%m%dT%H%M%SZ).sql
```

The four flags are not incidental:

| Flag                  | Why                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--clean --if-exists` | The dump drops what it is about to create, so restoring over a partially populated database is deterministic rather than a pile of "already exists" errors. |
| `--no-owner`          | The restore target's role may not be named the same thing. Ownership is reassigned to whoever runs the restore, which is why step 4 below names a role.     |
| `--no-privileges`     | Grants are the target deployment's business, not the source's. The dump therefore carries **no grant at all**, which is why step 5 below exists.            |

**The last two flags each cost you a step on the way back, and both costs are
deliberate** (Code Owner, 2026-10-22; issue #1094). A dump that named roles would be a
dump coupled to one deployment's role names, and a dump that carried ownership would be a
dump that only restores onto a cluster with the same roles. So the grants and the
ownership are re-established by the restore procedure rather than carried in the file, and
skipping either leaves a database the application cannot use: QCMS puts every application
grant in a migration, and the drizzle journal rides **inside** the dump, so a restored
database already reports every migration applied and re-running `migrate` grants nothing.

For anything but a small deployment prefer the custom format
(`--format=custom`), which restores with `pg_restore`, supports parallel restore
(`--jobs`) and compresses as it writes. The plain-SQL form above is used in the
examples and in the drill because it restores with nothing but `psql`, which is the
lowest-dependency path and the one most likely to still work in five years.

### Schedule

There is no one right schedule, only a stated tolerance. Pick the pair explicitly:

- **RPO** (how much data you can afford to lose) sets the dump interval. A daily dump
  means a bad day loses up to a day of responses.
- **RTO** (how long you can be down) sets the format and the rehearsal frequency.

A reasonable default for a single-VM deployment: a nightly dump, kept 7 daily / 4
weekly / 12 monthly, written to storage that is **not** the VM being backed up, with
the drill running weekly. Continuous archiving (WAL shipping, or a managed Postgres
with point-in-time recovery) is the upgrade when a day of loss stops being
acceptable, and it is the operator's infrastructure rather than something QCMS ships.

Encrypt the dumps at rest. They contain every answer every respondent has submitted.

## Restoring

Order matters, and the two steps people skip are 1 and 5.

```bash
# 1. Stop the writers. A restore into a live database races the application.
docker compose stop api portal admin

# 2. Make sure the roles exist. The restore and the re-grant both run as the migration
#    role, and `db-roles` creates it; on a stack that has never been up, or a database
#    this file does not manage, follow the "Least-privilege database roles" recipe in
#    docs/operations.md first.
docker compose up --no-deps db-roles

# 3. Recreate an empty database. Connections must go first: Postgres refuses to
#    drop a database anything is still connected to. The last statement is not
#    optional: `CREATE ON DATABASE` is a privilege ON the database, so dropping the
#    database destroys it, and without it the restore in step 4 cannot create a schema.
docker compose exec -T postgres sh -c '
  psql --username "$POSTGRES_USER" --dbname postgres --command \
    "select pg_terminate_backend(pid) from pg_stat_activity
     where datname = '"'"'$POSTGRES_DB'"'"' and pid <> pg_backend_pid();" &&
  dropdb --username "$POSTGRES_USER" "$POSTGRES_DB" &&
  createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB" &&
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --command \
    "GRANT CREATE ON DATABASE \"$POSTGRES_DB\" TO qcms_migrate;"'

# 4. Restore AS THE MIGRATION ROLE. ON_ERROR_STOP is not optional, and neither is
#    `--username qcms_migrate`: see below.
docker compose exec -T postgres \
  sh -c 'psql --username qcms_migrate --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on' \
  < qcms-20260807T000000Z.sql

# 5. Re-apply the grants. The dump carries none. Without this the application comes
#    back with no privilege on its own data and the first respondent write answers 500.
docker compose run --rm --no-deps migrate qcms-db-environment regrant

# 6. Bring the application back.
docker compose up --detach --wait
```

**`--set ON_ERROR_STOP=on` is the difference between a restore that failed and a
restore that reported success while skipping every statement after the first error.**
`psql` defaults to carrying on. A restore without it can exit 0 having created half a
schema, and the failure surfaces days later as a missing table.

### Why step 4 names `qcms_migrate`

`--no-owner` discards the dump's ownership and gives every restored object to **whoever
runs the restore**. Under SEC-10 the role that owns every QCMS schema is `qcms_migrate`,
so restoring as the bootstrap superuser leaves `control`, every `data_<env>` and every
`reporting_<env>` owned by a role the design says owns nothing: `pnpm qcms:environment` is
then refused by its ownership guard, the re-grant in step 5 cannot grant on objects it does
not own, and the next upgrade's migration fails on tables it cannot alter.

No password appears in step 4, and inside Compose none is needed. `psql` there connects
over the Unix socket, and the official Postgres image's `pg_hba.conf` carries initdb's own
default of `local all all trust`. **The image passes no `--auth` flag**, so that default is
inherited rather than chosen, and an operator who overrides it - `POSTGRES_INITDB_ARGS`
carrying `--auth-local=scram-sha-256` or `--auth=...`, on the `up` that first initialised
the data directory - will meet a password prompt here. Supply the credential the way you
supply every other one: `PGPASSWORD` from your secret store in the `exec` environment, or a
`.pgpass` entry, and never on the command line, where it reaches the process list. The same
applies to any restore outside Compose.

### Why step 5 exists at all

`--no-privileges` means the dump carries **no `GRANT` and no `REVOKE`**: zero lines,
against 39 in `packages/db/migrations/0000_environments_baseline.sql`. Every application
grant QCMS makes lives in a migration, and the drizzle journal is a table **inside** the
dump, so a restored database already reports every migration applied and running
`migrate` re-applies nothing. The result before this step existed: `qcms_app_prod` held no
`USAGE` on `data_prod` and no `INSERT` on `data_prod.sessions`, and the first respondent
write answered 500 (issue #1094).

`qcms-db-environment regrant` re-applies the whole model - the baseline's guarded grants,
each environment's grants, the control-schema grants including the `control.access_audit`
grants and the `qcms_app%` write revokes, and task 067's per-workspace reporting grants -
for **every** environment in `control.environments` and every workspace in
`control.organization`, so an environment or a workspace created after the last release is
covered too. **It grants and revokes, and never creates or drops an object**: the views come
back in the dump, and reconciling a missing one is `qcms-db-environment reporting`'s job.
Four properties are worth knowing:

- **It is idempotent.** Every statement is a `GRANT` or a `REVOKE`, which set a privilege
  rather than adding one, and there is no DDL in the set at all. So running it twice, or
  running it on a database that is already correct, changes nothing. Run it if you are not
  sure whether you have.
- **It cannot widen privilege.** The statements are the migrations' and the environment
  command's own bytes, emitted by the same generators, from one registry
  (`packages/db/src/environment/grants.ts`); a test fails if a `GRANT` appears anywhere in
  the migration tree that the registry does not produce, and
  `apps/api/e2e/security/04-db-restore-regrant.e2e.ts` compares the complete grant map -
  relations, columns, functions, types, schemas, default ACLs and large objects - before
  the dump and after the re-grant for equality.
- **It runs under the migration credential** and needs nothing beyond ownership of the
  QCMS schemas: no `CREATEROLE`, no `SUPERUSER`, no ownership of the database. The roles
  stay the operator's to create. **No error path prints a statement** (SEC-8): every
  database call it makes, the reads as well as the grants, reports the grant source or the
  read that failed plus the driver's own reason, and never the SQL. What that looks like on
  a refusal:

  ```
  qcms-db environment failed: could not re-apply control.access_audit (migration 0004): permission denied for schema control
  ```
- **No restart is needed.** A grant takes effect on the next statement, including on a pool
  that is already connected. This is unlike `qcms:environment create`, which needs one
  because a new environment's credential arrives through the process environment.

One statement in the model it deliberately does not re-apply: `REVOKE CREATE ON SCHEMA
public FROM PUBLIC`. A `REVOKE` on a schema requires owning it, and a freshly created
database owns `public` as `pg_database_owner`, which the migration role is not a member
of. PostgreSQL 15 and later grant `PUBLIC` no `CREATE` on a new `public` anyway, so the
property holds without it; the command reports a warning if it finds otherwise, and the
drill asserts the result.

The run that re-applies it is **step 6's** `docker compose up --detach --wait`, not step
2's. Step 2 runs before step 3 drops and recreates the database, so whatever it applied
goes with the old one. The statement lives in the `db-roles` service, and `db-roles` is a
`service_completed_successfully` dependency of `migrate`, which `api` depends on, so
bringing the stack back up is what runs it again, as the superuser, which is the role
that can.

### Step 6 runs the `migrate` one-shot, and that is harmless here

Do **not** run the `migrate` service _in order to migrate_ after a restore. The dump
contains drizzle's migrations table, so the restored database already knows its schema
version, and migrating it is at best a no-op and at worst applies a migration the dump
already contained.

Step 6 nevertheless starts it, and that is not a contradiction: `api` depends on `migrate`
completing, so `docker compose up --detach --wait` runs the one-shot whatever you intended.
It is a no-op for exactly the reason above - the journal came back in the dump, so
`drizzle-kit migrate` finds nothing to apply - and `--wait` would have failed the step if
it were not. If you would rather it did not run at all,
`docker compose up --detach --no-deps api portal admin` brings the three services back
without it.

Step 5 uses `docker compose run` on the same service to reach the `qcms-db-environment`
binary on its image; `--no-deps` keeps Compose from starting anything else, and the
service's own `qcms-db-migrate` command is replaced, so no migration runs there either.

If the restore is to a _newer_ QCMS version than the dump was taken from, restore
first and then migrate: that is an upgrade, and it follows the upgrade procedure in
`docs/operations.md`.

## The drill

```bash
QCMS_PORT_SEAT=<0-9> pnpm qcms:drill-restore
```

The drill is not a smoke test of `pg_dump`. It is the assertion that the restore path
produces a database the product actually works on. It:

1. Brings up a fresh stack and bootstraps an administrator.
2. Runs the full-stack browser suite, so the database holds real authored and
   answered domain data rather than fixtures.
3. **Reads the live environment set out of `control.environments`** and fingerprints every
   table's and every view's row count in `control` and in each environment's `data_<env>`
   and `reporting_<env>`, then takes a dump. The schema list is derived rather than
   written down, so an environment an operator created after this feature shipped is
   covered without a code change - which is the whole of why it is a query and not a list.
   Views are counted beside tables because the reporting views are what an adopter's BI
   tool is connected to, and a restore that brought back every row and none of the views
   would be a restore that looked perfect and served nothing.
   It also snapshots **every privilege every `qcms%` role holds**, on every object kind
   that can carry one, which step 5 compares against.
4. **Destroys the database**, and asserts not one QCMS table is left before going any
   further. A drill that restores over surviving data passes forever while proving
   nothing.
5. Restores from the dump **as `qcms_migrate`**, then **re-applies the grant model and
   holds the result against a snapshot taken in step 3**. First it asserts the restored
   database does _not_ yet hold the pre-dump grants, so the step cannot pass by doing
   nothing; then it runs `qcms-db-environment regrant`, asserts each environment's role
   holds `USAGE` on its data and reporting schemas and `INSERT` on its `sessions`, asserts
   `control`, `data_<env>` and `reporting_<env>` are owned by `qcms_migrate`, asserts
   `PUBLIC` holds no `CREATE` on `public`, and compares the whole grant map - relations,
   columns, functions, types, schemas, default ACLs and large objects - against the
   snapshot for **equality**, so a privilege the re-grant widened fails here. Then it runs
   the step again and asserts nothing changed. Finally it restarts the API.
6. Compares the fingerprint against the pre-dump one, **re-deriving the environment set
   first**: a restore that brought back a different set fails on that rather than on a
   fingerprint quietly taken over whichever set came back. It then asserts `public` is
   **empty**, because a restore that landed the tables there would resolve on every search
   path right up to the first time something else created a `sessions` table.
7. **Checks the pre-dump administrator survived by identity**: the account row, the
   credential better-auth signs in against, and the two-factor enrolment the first
   suite run performed. Row counts match whether or not the auth tables came back
   usable, so these are checked separately, because they fail separately: a dump that
   captured the account but not its two-factor row produces a login nobody can
   complete, which looks like a successful restore until it matters.
8. **Starts a real respondent session on a form published before the dump, and reads
   the first step back.** The drill POSTs to the portal's `/f/:slug/start`, follows the
   `303` to `/s/:sessionId` with the session cookie the portal issued, and asserts the
   step page carries a question label taken out of the restored `form_versions.compiled`
   document. That path is portal -> API -> restored rows -> the stored compilation
   (ADR-18: the portal serves the stored compilation, never a recompilation), so a
   restore that came back missing a form, its published version, its compiled document
   or the ability to insert a session row fails here.

Step 8 drives the respondent surface rather than re-running the browser suite, and
that is forced rather than chosen. The suite is a serial journey whose first step
enrols its account in MFA, and enrolment is one-shot, so re-running it as the pre-dump
account fails on that step for reasons that have nothing to do with the restore.
Bootstrapping a second administrator to run it instead is refused by design:
`createInitialAdmin` is the only door an account comes through and it closes the moment
one exists (SEC-1), so a drill that opened it again would be testing a system nobody
runs. The respondent surface needs no credential at all, which is why it can carry the
claim. Splitting the two claims (the old account is checked by identity in step 7, the
schema is checked by being used in step 8) tests each with the tool that can see it.

The seat is required (R8, `docs/PORTS.md`) because the drill drives the same
throwaway Compose stack as `pnpm up:e2e`, and the seat picks that stack's project
name. Teardown runs `docker compose down --volumes` under it, so an adopted seat
would delete another lane's stack rather than merely read it.

### What the drill does not cover

It drops and rebuilds the **database**, not the Postgres **container**. That
exercises the path a real restore takes (`psql` into an empty database) and is
bounded by the harness: inside the dev container the browser suite reaches the stack
through a loopback forwarder that resolved the portal and admin container addresses
when the stack came up, so recreating those containers mid-drill would fail as a
networking error dressed up as a restore bug.

"The Postgres host was lost" is a topology drill against the operator's own
infrastructure (volume snapshots, a standby, a managed failover) rather than a data
drill, and QCMS cannot rehearse it for you. What QCMS can promise, and does test, is
that its dump restores into an empty database and that the product works afterwards.

Task 067 recorded a **known limitation** here: a restored database held no application
grant and the wrong owner, so the drill's step 8 was red. That limitation is **closed**
(issue #1094, PR #1099). The restore runs as `qcms_migrate` and ends with
`qcms-db-environment regrant`, both documented above, and the drill asserts the grant map
and the ownership rather than reporting their absence.

It does not cover **a per-environment restore**, and there is no such thing to cover: the
environments are schemas in one database, so there is one dump and one restore, and
restoring `test` without `prod` would mean editing a dump by hand. An operator who wants a
copy of production data in a test environment is asking for a different thing and should
build it as one, deliberately and with erasure and retention applied - this drill is about
getting the installation back.

It also does not cover key material, for the reason in the first section: the keys are
deliberately not in the dump. Rehearse that half by restoring into a stack whose
`QCMS_APP_KEY` came from your key backup, not from the environment that took the dump.

## Related

- `docs/operations.md` - env reference, upgrade procedure, key rotation runbooks
- `docs/deploy-enterprise.md` - the segmented topology, where the database sits in its own zone
- `docs/deploy-ingress.md` - ingress and TLS recipes
