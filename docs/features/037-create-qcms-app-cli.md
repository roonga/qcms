# 037 - create-qcms-app CLI

**Stage:** 8b · **Package:** `create-qcms-app` (new publishable) · **Depends on:** 036
**References:** ADR-05 (owned shell / versioned core), **ADR-19** (CLI not on the launch gate) · `ARCHITECTURE.md` §2

## Context

The shadcn-ethos delivery vehicle: stamp the owned shell (apps, compose, config) into the adopter's repo, referencing the versioned packages (`@qcms/core`, `a2ui-compiler`, `db`, `ui`) as dependencies. Per ADR-19, launch does not block on this task - if it slips, 038 proceeds with the documented manual setup from 036.

## Deliverables

- `pnpm create qcms-app my-forms` (npm-init compatible) prompting for: project name, package manager, deployment shape (solo/enterprise), admin 2FA default, portal base URL. Non-interactive flags for CI (`--yes` with defaults).
- Stamps into the target: `apps/api`, `apps/portal`, `apps/admin` **shell source** (composition roots, BFF handlers, theming, auth config, challenge adapter, message catalog - the code adopters own per the ownership seam) importing the four packages by version; `docker-compose.yml` + Dockerfiles from 036; `.env.example` generated from the config schema; README tailored to the chosen shape; git init + first commit.
- Template maintenance strategy: templates generated from the canonical apps at CLI build time (not hand-copied - a sync script with a CI check that templates and apps haven't drifted), minus repo-internal dev scaffolding. Document what is owned-after-scaffold vs upgraded-via-packages (`docs/ownership-seam.md`).
- Post-scaffold smoke: the CLI's final message prints the exact next commands (env → compose up → migrate → create-admin → open admin).
- CLI e2e in CI: scaffold into a temp dir → install → `docker compose up` → 027 scenario-1 smoke → down. (This is also 038's raw material.)

## Exit criteria

1. CLI e2e green in CI from published-package tarballs (`pnpm pack`, not workspace links - proving the adopter experience).
2. Template-drift check green (and demonstrably fails when an app shell file changes without regeneration).
3. Scaffolded README accurate: a scripted run of its commands succeeds.
4. `docs/ownership-seam.md` lists every scaffolded path and every package dependency with its upgrade story.

## Out of scope

Templates for Kubernetes/managed clouds (issues), interactive upgrade/codemod tooling (Phase 4 issue), multi-tenancy scaffolding (R7).
