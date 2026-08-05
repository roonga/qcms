# 036 - Ops docs, ingress recipes, and image supply chain

**Stage:** 8b · **Scope:** `docs/`, repo root, `docker/` · **Depends on:** 035 (feature-complete apps)
**References:** `ARCHITECTURE.md` §9, §10 · ADR-09, **ADR-20** · SEC-9 · review resolution "ops story"

## Context

The distribution collateral that makes self-hosting real: same images for solo and enterprise, difference is instance count and mount flags. The ops docs are launch deliverables with tested claims, not aspirations.

The container half of that story landed early, out of numeric order, in PR #286. What is left is the documentation, the ingress recipes, the drill, and the image supply chain. Read the "Already delivered" section before planning: re-doing any of it is wasted work, and the compose topology it left behind is the thing the remaining docs must describe.

## Already delivered (PR #286 - do not redo)

- **Production Dockerfiles** for `api`, `portal`, `admin`: multi-stage, pruned with `pnpm deploy --prod`, non-root (`USER node`), Node 24, OCI labels, an `ARG VERSION` build arg, and image healthchecks (`/ready`, `/`, `/healthz`).
- **Solo `docker-compose.yml`:** portal and admin published; `api` and `postgres` publish no host port (ADR-20); named volume; Postgres healthcheck; a one-shot `migrate` service, so migration is an explicit step rather than migrate-on-boot.
- `.env.compose.example`, `.dockerignore`, and a README quickstart.
- A full-stack browser flow in CI (the `full-stack-e2e` job in `.github/workflows/e2e.yml`, spec at `apps/e2e/`) that boots the stack over real containers, bootstraps a fresh admin, authors a conditional multi-step form, publishes it, and completes both respondent branches. Driven by `pnpm docker:up` / `docker:down` / `test:e2e` / `up:e2e`.

## Deliverables (remaining)

- **Ingress and TLS recipes (ADR-20):** ingress and TLS are operator infrastructure. Document a cloud-LB recipe (e.g. ECS + ALB terminating TLS) and ship an optional `docker-compose.proxy.yml` Caddy overlay (auto-certs) for single-VM hosts. Both recipes state that the apps assume TLS at ingress, that HSTS is set there, and that only portal and admin are routed - the API is never published.
- **Enterprise recipe** (`docs/deploy-enterprise.md`): two API instances (public mount vs internal+admin+workers), admin app on VPN, network segmentation diagram, env matrix per process.
- **Backup/restore** (`docs/backup-restore.md`): `pg_dump` schedule guidance, restore procedure, **and a scripted restore drill** (`pnpm qcms:drill-restore`: dump seeded DB → restore into fresh container → e2e smoke passes against it) run in CI weekly or on demand.
- **Ops guide** (`docs/operations.md`): env reference (generated from 017's config schema so it can't drift - assert in test), log format and collector pointers, health/ready semantics, upgrade procedure (`pnpm up` + migrate + restart order), webhook dead-letter runbook, erasure runbook, secure-link key rotation runbook (from 010/024). Record **why** migration is a separate step: multi-instance safety and adopter control.
- **Image supply chain:** SBOM per image, and a real version stamp - `ARG VERSION` exists but nothing passes it, so every image today is labelled `version=dev`. CI builds the three images on every push.
- **Compose config test** for exit criterion 5: an assertion, not just the property holding today.

## Exit criteria

1. Restore drill green in CI.
2. Env reference generated and asserted against the config schema.
3. `docker compose up` from the README works on a clean machine (verified in 038), and the images it pulls carry a real version stamp and an SBOM.
4. Enterprise recipe reviewed against 027's mount-split scenario (flags match documentation).
5. Compose config test green: `api` and `postgres` publish no host ports (ADR-20); the Caddy overlay routes only portal and admin.

## Out of scope

The scaffolding CLI (037), Kubernetes manifests (adopter recipe issue), managed-cloud guides (issues), observability stack (logs-to-stdout only, per §10).

Also out of scope here, because they are already tracked: **#291** (Next standalone output in the images), **#292** (secure-cookie configuration across portal and admin), **#293** (root `scripts/` has no lint coverage), **#294** (`@qcms/db` migrate entry point).
