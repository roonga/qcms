# Backup and restore

Postgres is the only durable state QCMS has. The containers are disposable, the
images are rebuildable, and the secrets live in the operator's environment. So the
whole of this document is about one database, and the one claim worth making about
it: **a backup nobody has restored is not a backup, it is a file.**

That claim is why the restore procedure below has a script behind it
(`pnpm qcms:drill-restore`) that runs on a schedule in CI rather than sitting here as
an instruction someone will follow for the first time during an incident.

## What is in scope

| State | Where it lives | Backed up by |
| --- | --- | --- |
| Forms, versions, responses, answers, sessions | Postgres | `pg_dump` |
| Administrator accounts and two-factor material | Postgres | `pg_dump` |
| Outbox and delivery history | Postgres | `pg_dump` |
| Erasure tombstones (compliance evidence) | Postgres | `pg_dump` |
| Signing and encryption keys | the environment, never the database | **you**, separately |
| Built images | a registry, or rebuilt from a tag | not backed up |

The last two rows are the ones that bite.

**Keys are not in the dump, and a dump is useless without them.** `QCMS_APP_KEY`
encrypts webhook signing secrets at rest (SEC-6), so a database restored alongside a
different `QCMS_APP_KEY` comes back with those columns permanently undecryptable.
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

| Flag | Why |
| --- | --- |
| `--clean --if-exists` | The dump drops what it is about to create, so restoring over a partially populated database is deterministic rather than a pile of "already exists" errors. |
| `--no-owner` | The restore target's role may not be named the same thing. Ownership is reassigned to whoever runs the restore. |
| `--no-privileges` | Grants are the target deployment's business, not the source's. |

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

Order matters, and step 1 is the one people skip.

```bash
# 1. Stop the writers. A restore into a live database races the application.
docker compose stop api portal admin

# 2. Recreate an empty database. Connections must go first: Postgres refuses to
#    drop a database anything is still connected to.
docker compose exec -T postgres sh -c '
  psql --username "$POSTGRES_USER" --dbname postgres --command \
    "select pg_terminate_backend(pid) from pg_stat_activity
     where datname = '"'"'$POSTGRES_DB'"'"' and pid <> pg_backend_pid();" &&
  dropdb --username "$POSTGRES_USER" "$POSTGRES_DB" &&
  createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB"'

# 3. Restore. ON_ERROR_STOP is not optional.
docker compose exec -T postgres \
  sh -c 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on' \
  < qcms-20260807T000000Z.sql

# 4. Bring the application back.
docker compose up --detach --wait
```

**`--set ON_ERROR_STOP=on` is the difference between a restore that failed and a
restore that reported success while skipping every statement after the first error.**
`psql` defaults to carrying on. A restore without it can exit 0 having created half a
schema, and the failure surfaces days later as a missing table.

Do **not** run the `migrate` service after a restore. The dump contains drizzle's
migrations table, so the restored database already knows its schema version; running
migrations against a restored database is at best a no-op and at worst applies a
migration the dump already contained.

If the restore is to a *newer* QCMS version than the dump was taken from, restore
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
3. Fingerprints every table's row count and takes a dump.
4. **Destroys the database**, and asserts the public schema is genuinely empty before
   going any further. A drill that restores over surviving data passes forever while
   proving nothing.
5. Restores from the dump and restarts the API.
6. Compares the fingerprint against the pre-dump one.
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

It also does not cover key material, for the reason in the first section: the keys are
deliberately not in the dump. Rehearse that half by restoring into a stack whose
`QCMS_APP_KEY` came from your key backup, not from the environment that took the dump.

## Related

- `docs/operations.md` - env reference, upgrade procedure, key rotation runbooks
- `docs/deploy-enterprise.md` - the segmented topology, where the database sits in its own zone
- `docs/deploy-ingress.md` - ingress and TLS recipes
