# 036 - Production images, compose, and ops docs

**Stage:** 8b · **Scope:** repo root, `docker/`, docs · **Depends on:** 035 (feature-complete apps)
**References:** `ARCHITECTURE.md` §9, §10 · ADR-09, **ADR-20** · SEC-9 · review resolution "ops story"

## Context

The distribution collateral that makes self-hosting real: same images for solo and enterprise, difference is instance count and mount flags. The ops docs are launch deliverables with tested claims, not aspirations.

## Deliverables

- **Production Dockerfiles** (multi-stage, pnpm-pruned, non-root, Node LTS) for `api`, `portal`, `admin`; image healthchecks hitting `/health`; SBOM/labels; build args for version stamping.
- **Solo `docker-compose.yml`:** portal · admin · api (all groups + workers; **no published port** - reachable only by the two BFFs on the compose-internal network) · postgres (named volume, healthcheck). **Ingress/TLS is operator infrastructure (ADR-20):** document a cloud-LB recipe (e.g. ECS + ALB terminating TLS) and ship an optional `docker-compose.proxy.yml` Caddy overlay (auto-certs) for single-VM hosts; both recipes state that the apps assume TLS at ingress, set HSTS there, and route **only portal and admin** - the API is never published. Migration strategy: an explicit migrate step (one-shot service or documented command) - **not** auto-migrate-on-boot (document why: multi-instance safety, adopter control).
- **Enterprise recipe** (`docs/deploy-enterprise.md`): two API instances (public mount vs internal+admin+workers), admin app on VPN, network segmentation diagram, env matrix per process.
- **Backup/restore** (`docs/backup-restore.md`): `pg_dump` schedule guidance, restore procedure, **and a scripted restore drill** (`pnpm qcms:drill-restore`: dump seeded DB → restore into fresh container → e2e smoke passes against it) run in CI weekly or on demand.
- **Ops guide** (`docs/operations.md`): env reference (generated from 017's config schema so it can't drift - assert in test), log format and collector pointers, health/ready semantics, upgrade procedure (`pnpm up` + migrate + restart order), webhook dead-letter runbook, erasure runbook, secure-link key rotation runbook (from 010/024).
- CI: image builds on every push; a compose smoke job - `docker compose up` → healthchecks green → run the 027 scenario-1 flow against the composed stack → down.

## Exit criteria

1. Compose smoke job green in CI: full loop over real containers.
2. Restore drill green in CI.
3. Env reference generated and asserted against the config schema.
4. Images run non-root; healthchecks wired; `docker compose up` from the README works on a clean machine (verified in 038).
5. Enterprise recipe reviewed against 027's mount-split scenario (flags match documentation).
6. Compose config test: `api` and `postgres` publish no host ports (ADR-20); the Caddy overlay routes only portal and admin.

## Out of scope

The scaffolding CLI (037), Kubernetes manifests (adopter recipe issue), managed-cloud guides (issues), observability stack (logs-to-stdout only, per §10).
