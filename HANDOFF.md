HANDOFF: BLOCKED #316 - 036 cannot merge under the CI-substitution protocol until full-stack-e2e is runnable locally

# 036 - Ops docs, ingress recipes, and image supply chain

- **Task file:** `docs/features/036-ops-images-compose.md` (read its "Already delivered (PR #286 - do not redo)" section first).
- **Branch:** `feat/036-ops-docs-supply-chain`
- **Base commit:** `aea47d9` (`docs(adr,features): land the ADR-17 outbox amendment and task 059 (#285)`)
- **WIP commit:** `e0f8c46`
- **Status:** parked by the conductor mid-implementation. The branch's blast radius (compose, ingress, env plumbing, config) is exactly what #316 gates, so 036 is ordered behind it.

## NO GATES WERE RUN

The branch state is **unverified**. `pnpm verify`, `pnpm exec turbo run test --force` and `pnpm verify:browser` were never invoked. The only things actually executed were two narrow, cheap checks (recorded below because they are real evidence and would otherwise be re-derived):

- `pnpm exec vitest run --project tooling scripts/compose-config.test.ts` - **11 passed**, ~270ms.
- A deliberate mutation of that gate (published `9999:3000` on `api`, added `reverse_proxy api:3000` to the Caddyfile) turned **6 of the 11 red**, and the tree was restored (`git diff --stat` clean afterwards). The gate has teeth.

Everything else, including whether the repo typechecks and lints with `scripts/env-reference.mjs` present, is unknown.

## State per remaining deliverable

| Deliverable (task file) | State |
| --- | --- |
| Ingress/TLS recipes + `docker-compose.proxy.yml` Caddy overlay | **Code done, docs not started.** Overlay and `docker/Caddyfile` written and validated; `docs/deploy-ingress.md` (the intended home for the ECS+ALB recipe and the single-VM recipe) does not exist yet. |
| Enterprise recipe `docs/deploy-enterprise.md` | **Not started** (research complete, see below). |
| Backup/restore `docs/backup-restore.md` + `pnpm qcms:drill-restore` | **Not started.** `scripts/compose-e2e.mjs` was refactored specifically to make the drill cheap to write (see below). |
| Ops guide `docs/operations.md` + generated env reference | **Generator done, doc not started.** `scripts/env-reference.mjs` is complete; `scripts/env-reference.test.ts` and `docs/operations.md` do not exist, so nothing asserts it yet. |
| Image supply chain (SBOM + real version stamp, CI builds three images) | **Not started in the repo**, but the mechanism was proven by hand (see below). |
| Compose config test | **Done and passing** (`scripts/compose-config.test.ts`). |

## What is on the branch

### `docker/Caddyfile` (new)

Two site blocks, two upstreams (`portal:3000`, `admin:3000`), and deliberately no API or Postgres route: that absence is the ADR-20 control. A shared `(qcms_edge)` snippet carries `encode`, HSTS (`max-age=63072000; includeSubDomains; preload`), `-Server`, and a `request_body max_size 1MB` matching `QCMS_BODY_LIMIT_BYTES` at the edge (SEC-9). Each site sets `header_up X-Forwarded-Proto https` because the hop to the app is plain HTTP on the bridge network.

**The upstreams are written out per site rather than factored through a snippet argument** (`{args[0]}`). That was a deliberate reversal: the argument form works, but a file where "what is routed" reads top to bottom is the property both the compose-config test and a reviewing operator check.

Validated with `caddy validate` and formatted to `caddy fmt`'s output:

```
docker run --rm -i -e QCMS_PORTAL_DOMAIN=... -e QCMS_ADMIN_DOMAIN=... -e QCMS_ACME_EMAIL=... \
  caddy:2-alpine sh -c 'cat > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile --adapter caddyfile' \
  < docker/Caddyfile
# -> "Valid configuration"
```

Note the `sh -c 'cat > ...'` shape. **A `-v $PWD/docker/Caddyfile:/etc/caddy/Caddyfile` bind mount of a single file fails from inside this dev container** (the host Docker daemon resolves the bind-mount source to a directory). That is a dev-container quirk only; the overlay's bind mount is fine for a real operator. Do not waste a cycle on it.

### `docker-compose.proxy.yml` (new)

Adds one `caddy` service publishing 80/443 tcp + 443 udp on all interfaces, with `QCMS_CADDY_IMAGE` overridable, three required interpolations (`QCMS_PORTAL_DOMAIN`, `QCMS_ADMIN_DOMAIN`, `QCMS_ACME_EMAIL`), named volumes for `/data` and `/config`, and `depends_on` portal + admin `service_healthy`.

The header comment records the one thing that surprised me and would otherwise be rediscovered: **Compose merging cannot remove a `ports:` entry**, so portal and admin keep the base file's loopback publishes when the overlay is layered on. That is left deliberate and documented (a loopback publish is a useful incident door, and Caddy reaches both apps over the Compose network anyway); the guidance is to leave `QCMS_BIND_ADDRESS` at its `127.0.0.1` default when using the overlay.

### `scripts/docker.mjs` (new)

Shared Docker plumbing: `REPOSITORY_ROOT`, `DOCKER`, `CommandFailed`, `runProcess`, `captureProcess`, `composeConfig({files, env, envFile})`, `publishedPorts(config, service)`. Extracted because three callers now spawn `docker` (`compose-e2e.mjs`, the compose-config gate, and the not-yet-written restore drill) and had begun to agree only by copy.

**On the subprocess-binary-path constraint** (`sonarjs/no-os-command-from-path`): `resolveDocker()` reproduces `compose-e2e.mjs`'s existing behaviour exactly - `QCMS_DOCKER_BIN` override wins, then a probed absolute Docker Desktop path on win32, then a bare PATH lookup. It does **not** introduce an absolute-path resolution beyond that, because root `scripts/**` has **no ESLint run** today (issue #293, explicitly out of scope for 036): `pnpm lint` is `turbo run lint` over packages/apps plus `prettier --check .`, and no package's lint script covers the root `scripts/` directory. `eslint.config.js:90` *does* carry a `**/scripts/**/*.{js,mjs,cjs}` block, so the rule will apply the moment #293 wires a run - at which point the bare `"docker"` fallback in this file and the pre-existing one in `compose-e2e.mjs` both need an absolute resolution together. Note the task briefing anticipated this rule firing on the drill script; on the current tree it does not, and that is a coverage gap rather than a clean bill of health.

### `scripts/compose-e2e.mjs` (modified) - a refactor for the drill, not a behaviour change

- Binary resolution, `CommandFailed` and the "throw, never `process.exit`" runner moved to `scripts/docker.mjs`.
- `up`, `down`, `test`, `describe`, `credentialsPath`, `e2eEnvironment` and a new `composeRun(args)` are now **exported**.
- The CLI is guarded by `if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])`, so importing the module does not try to parse the importer's argv as a subcommand.

Verified both halves still work: `node scripts/compose-e2e.mjs` prints the usage error, and `import()` reports `composeRun,credentialsPath,describe,down,e2eEnvironment,test,up`.

**Why:** the restore drill is meant to reuse this exact stack rather than stand up a parallel one. The intended drill shape (designed, not written) is:

1. `up()` - fresh stack, bootstrap admin, write the credentials file.
2. `test()` - the existing full-stack Playwright flow authors, publishes and answers, so the database holds real domain data.
3. Capture a fingerprint (row counts) via `docker compose exec -T postgres psql`.
4. `pg_dump` to a host file.
5. `docker compose down --volumes` - the database is genuinely destroyed.
6. `up postgres --wait` on a fresh volume, then restore the dump.
7. Bring the rest up. The `migrate` service is a no-op because drizzle's migrations table is in the dump.
8. Assert the fingerprint survived, then `test()` **again** - it signs in with the **pre-dump** credentials, which is what actually proves the restored account and schema work.
9. `down()` in a `finally`.

Step 8's second `test()` run is safe: `apps/e2e/full-stack-conditional-form.pw.ts` derives every slug and question id from `RUN = Date.now().toString(36)`, so the spec is re-runnable against a database it has already written to. Confirmed by reading the spec; not executed.

### `scripts/compose-config.test.ts` (new) - exit criterion 5, done

11 tests in the `tooling` Vitest project. It shells out to `docker compose config --format json` rather than parsing YAML, deliberately: overlay merge semantics are Compose's rules, and the merged document an operator actually gets is the only thing worth asserting against. It asserts:

- `api` and `postgres` publish no host port, in the base config **and again after the proxy overlay is layered on**.
- Only `portal` and `admin` publish anything in the base config, and both bind to `127.0.0.1`.
- `migrate` exists with `restart: "no"` (migration is a separate step, not migrate-on-boot).
- With the overlay, `caddy` is the only service bound outside loopback, publishing exactly `80:80/tcp`, `443:443/tcp`, `443:443/udp`.
- The Caddyfile's `reverse_proxy` upstreams are **exactly** `["admin:3000", "portal:3000"]`, and (with comments stripped first, so the explanation of the absence cannot make the assertion permanently red) the policy never contains `api:` or `postgres:`.
- HSTS is set at the ingress.

### `scripts/env-reference.mjs` (new) - the generator half of exit criterion 2

Complete but **entirely unasserted**: `scripts/env-reference.test.ts` and `docs/operations.md` were the next two files and do not exist. Running `node scripts/env-reference.mjs --write` today will throw, because the target document is missing.

Design, and the reasoning behind it, because it is the least obvious piece:

- `ENV_REFERENCE` is a hand-written table of ~75 rows (name, process, requirement, default, secret flag, description) grouped `api` / `portal` / `admin` / `compose`. Descriptions are prose and stay prose: a useful description cannot be extracted from a parser call.
- **What the machine owns is names and requirement**, because those are what drift silently. Three assertions were planned for `env-reference.test.ts`:
  1. For each of api/portal/admin, `scanEnvNames(p)` must **equal** the table's names for `p`, both directions.
  2. For every API variable `apiRequirementFromParsers()` can classify, the parser helper's implied requirement must match the table's `requirement` column.
  3. `docs/operations.md`'s block between `BEGIN GENERATED: env-reference` / `END GENERATED` markers must equal `renderEnvReference()` byte for byte.
  4. (Planned extra) every variable in `.env.compose.example` appears somewhere in the table.
- `scanEnvNames` globs **directories** via `git ls-files`, not a hand-maintained file list - a file list is the same drift the module exists to prevent. It strips comments first (otherwise `apps/admin/lib/server/config.ts`'s header comment, which names `DATABASE_URL` and `QCMS_ADMIN_AUTH_SECRET` as *deliberately absent*, would register them as reads), then unions two rules: direct `env.NAME` / `process.env.NAME` / `env["NAME"]` access, and a double-quoted `"QCMS_*" | "TURNSTILE_*" | "OTEL_*" | "DATABASE_URL"` literal (which is how 017's parsers take a name).
- `parseRateClass(env, "PREFIX", ...)` is special-cased: the prefix is **not** a variable, it names a pair. The suffixes are read out of `parseRateClass`'s own body (`` `${prefix}_WINDOW_MS` ``, `` `${prefix}_MAX` ``) rather than hardcoded, and `rateClassSuffixes()` throws a directive error if that template ever disappears.
- The `compose` group scans `${VAR}` interpolation with a `(?<!\$)` lookbehind, so the container-side `$${POSTGRES_USER}` inside the Postgres healthcheck is not mistaken for an operator variable.
- **Group membership rule the test must encode:** a name read by both an app and the Compose files (e.g. `QCMS_LINK_KEYS`) belongs to the app group only. The `compose` group is `scanNames("compose")` **minus** the union of the three app scans, so no row is duplicated. This is written in the module's structure but not yet enforced anywhere.

The scan output was verified by hand against all three apps and both compose files; the table below reflects reality on `aea47d9`.

## Findings the next session should not have to rediscover

1. **`QCMS_TURNSTILE_SITE_KEY` vs `TURNSTILE_SITE_KEY`.** The portal reads `QCMS_TURNSTILE_SITE_KEY` (`apps/portal/lib/server/challenge.ts`), while the API reads the unprefixed `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (`apps/api/src/config.ts`). An operator enabling Turnstile must set both spellings. This is a genuine pre-existing inconsistency, cross-app, and picking a winner needs a decision plus a migration note - **it is an issue, not a 036 fix.** The env reference documents both spellings truthfully in the meantime.
2. **`PORT` and `QCMS_PORT`.** `apps/api/src/main.ts:83` reads `process.env.PORT ?? process.env.QCMS_PORT ?? 3000`, and `docker-compose.yml` sets `PORT: 3000` on the `api` service. Both spellings are live; this is *not* the mismatch it first looks like.
3. **The 027 mount split, for the enterprise recipe (exit criterion 4).** `apps/api/e2e/04-mount-split.e2e.ts` composes with `MountFlags` objects, not `QCMS_MOUNT` strings. The presets in `apps/api/e2e/support/harness.ts:36-40` are `publicOnly = {public:true,internal:false,admin:false}` and `adminOnly = {public:false,internal:true,admin:true}`. Run through `parseMount`, the equivalent env strings the recipe must document are **`QCMS_MOUNT=public`** for the respondent instance and **`QCMS_MOUNT=internal,admin`** for the authoring/worker instance. Workers ride the `internal` flag (`apps/api/src/main.ts:74-80` starts the retention sweep and outbox deliverer iff `config.mount.internal`), so the second instance owns them. The `internal` registrar list is empty today (`apps/api/src/registrars.ts:46`); its real effect is scheduler ownership.
4. **`docker buildx --sbom=true` needs no new dependency and was proven locally.** `docker buildx build --sbom=true --provenance=mode=max --build-arg VERSION=... --output type=oci,dest=<dir>,tar=false .` writes a plain OCI **directory** layout (buildx 0.35.0 on this machine; `tar=false` is what avoids needing a tar reader in Node). Traversal for the assertion: `index.json` -> manifest list -> the manifest whose `platform.architecture` is `unknown` carries layers of media type `application/vnd.in-toto+json` annotated `in-toto.io/predicate-type: https://spdx.dev/Document` (SBOM) and `https://slsa.dev/provenance/v1` (provenance). The version stamp is assertable from the *other* manifest's config blob at `.config.Labels["org.opencontainers.image.version"]`. All of this was executed against a throwaway busybox image and the scratch artifacts were deleted. Note the SBOM step pulls `docker.io/docker/buildkit-syft-scanner:stable-1`, so the new job must **not** use `.github/actions/assert-no-docker-hub-pulls` (the existing `full-stack-e2e` job sets the same precedent for base-image pulls).
5. **Version stamping is a one-line gap.** All three Dockerfiles already declare `ARG VERSION=dev` and label `org.opencontainers.image.version="${VERSION}"` in the runtime stage. Nothing passes it: `docker-compose.yml`'s four `build:` blocks carry no `args:`, so every image is labelled `version=dev`. The planned fix was `args: { VERSION: ${QCMS_IMAGE_VERSION:-dev} }` plus a `scripts/build-images.mjs` deriving a real value from the root `package.json` version (`0.0.1-alpha.0`) and the short git SHA.
6. **`docs/deploy-ingress.md` is a net-new doc not named in the exit criteria.** It was chosen as the home for the two ingress recipes because the deliverable ("document a cloud-LB recipe ... and ship an optional overlay") clearly implies one and none of the three named docs is a natural fit. If the next session or a reviewer prefers those recipes folded into `docs/operations.md`, that is a defensible alternative; nothing on the branch depends on the choice.
7. **`docs/PORTS.md` needs a one-line note.** The overlay publishes 80/443, which are not QCMS allocations. `pnpm check:ports` does not flag them (the `${VAR:-NNNN}` and prose patterns need 4-5 digits or a `:-` default, and the overlay writes bare `"80:80"`), but PORTS.md claims to be the only place ports are written down, so it should say that the ingress owns the standard web ports. **Do not write "port 8443" anywhere** - the prose pattern would catch it.
8. **CI house style for the new workflows** (gathered, unused): third-party actions get patch pins (`pnpm/action-setup@v6.0.9`), GitHub-owned get majors (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`). Three weekly crons already exist, all Monday and staggered (02:00, 03:00, 04:17), so a restore-drill schedule needs a fourth free slot. `docker buildx` is available on `ubuntu-latest` with no setup action (`mirror-test-images.yml` uses it bare), though a `--sbom` build wants the docker-container driver, i.e. `docker buildx create --use`.
9. **No changeset is needed.** Nothing under `packages/*` is touched, so `check:changeset` has nothing to demand.

## Next step when #316 lands

Rebase onto the new `origin/main`, run `pnpm install` in the worktree first (a moved lockfile otherwise produces a wall of `TS2307` that reads exactly like this branch's own breakage), then continue at `docs/operations.md` + `scripts/env-reference.test.ts` - that pair closes exit criterion 2 and unblocks everything the other docs cross-link to.
