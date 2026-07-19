# 001 — Repository bootstrap

**Stage:** 0 · **Scope:** repo root · **Depends on:** nothing
**References:** `ARCHITECTURE.md` §4 and §13 (full tree) · `IMPLEMENTATION_PLAN.md` Stage 0
**Inputs you are given:** the repo already exists (created at workshop setup, 2026-07-19) with the document bundle committed — `docs/` (top-level plan docs, `features/`, `wireframes/`), `PROJECT_INSTRUCTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, and the `.claude/` agentic workshop (agents, skills, settings). This task adds the toolchain skeleton around them — after this task, `pnpm build && pnpm test` is green and every later task lands in its final home.

## Context

Everything later lands in this skeleton. Nothing has content yet; the point is that build, test, lint, versioning, and CI all work before any real code exists, and that the document set travels with the repo (agents are stateless — the repo is the memory).

## Deliverables

### 1. Directory skeleton (create exactly this; deeper structure arrives with later tasks)

```
qcms/
├── package.json              # private root; scripts: build/test/lint/typecheck via turbo
├── pnpm-workspace.yaml       # packages: ["packages/*", "apps/*", "tooling/*"]
├── turbo.json
├── tsconfig.base.json
├── .nvmrc  .npmrc  .gitignore  .env.example
├── LICENSE                   # MIT
├── README.md                 # quickstart stub (see §5)
├── PROJECT_INSTRUCTIONS.md   # from the bundle, verbatim
├── CONTRIBUTING.md           # from the bundle, verbatim (coding standards, PR rules)
├── .changeset/config.json
├── .github/workflows/ci.yml
├── docs/                     # the bundle: *.md, scope html, features/
├── packages/
│   ├── core/          {package.json, tsconfig.json, src/index.ts, src/index.test.ts}
│   ├── a2ui-compiler/ {same}
│   ├── db/            {same}
│   └── ui/            {same}
├── apps/
│   ├── api/           {package.json (private), tsconfig.json, src/index.ts, src/index.test.ts}
│   ├── portal/        {same}
│   └── admin/         {same}
├── tooling/           # empty with .gitkeep (037 fills it)
└── docker-compose.dev.yml
```

Package names: `@qcms/core`, `@qcms/a2ui-compiler`, `@qcms/db`, `@qcms/ui` (publishable, `"private": false`, version `0.0.0`); apps `qcms-api`, `qcms-portal`, `qcms-admin` (`"private": true`). Each `src/index.ts` exports a placeholder const; each `index.test.ts` asserts it (proves the pipeline, deleted by later tasks).

### 2. Toolchain configuration

- `tsconfig.base.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"skipLibCheck": true`. Each package/app tsconfig extends it.
- `turbo.json` tasks: `build` (dependsOn `["^build"]`, outputs `dist/**`), `test` (dependsOn `["build"]`), `lint`, `typecheck`. Root scripts call `turbo run <task>`.
- Vitest: single root `vitest.workspace.ts` listing all packages/apps; no per-package runners.
- ESLint flat config at root (typescript-eslint recommended-type-checked) + Prettier (defaults; `printWidth: 100`); `pnpm lint` runs both (prettier --check).
- Changesets: `pnpm changeset` initialized; `access: public`; ignore the three apps.
- `.nvmrc`: current Node LTS major. Root `package.json`: `"packageManager": "pnpm@<current>"`, `"engines": { "node": ">=<LTS>" }`.
- Install only tooling devDependencies (typescript, vitest, turbo, eslint, prettier, @changesets/cli). **No runtime deps** — later tasks own their own (Zod arrives with 002, Hono with 017, etc.). Playwright is the pinned e2e framework (ADR-23) but its toolchain arrives with the first browser surface (029) — do **not** install it or its browsers here.

### 3. Dev database

`docker-compose.dev.yml`: `postgres:16-alpine`, port 5432, named volume, healthcheck (`pg_isready`), env from `.env`; `.env.example` with `DATABASE_URL=postgres://qcms:qcms@localhost:5432/qcms` and a comment header "copy to .env".

### 4. CI (`.github/workflows/ci.yml`)

On push + PR: checkout → pnpm/action-setup (version from packageManager) → setup-node (from .nvmrc, pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`. Branch protection on main requiring this workflow is a repo-settings step — note it in the PR description for the owner.

### 5. Documents and README

- Verify the bundle is present and current (`docs/*.md`, `docs/features/`, `docs/wireframes/`, root `PROJECT_INSTRUCTIONS.md` + `CONTRIBUTING.md` + `CLAUDE.md`) — committed at workshop setup; sync from `qcms-plan` if the plan changed since. Add the scope-v2 HTML to `docs/` when the owner supplies it (not in the bundle yet).
- `README.md` stub: one-paragraph project description (crib from PROJECT_GOAL §1), the two-command quickstart (`pnpm install && pnpm test`; `docker compose -f docker-compose.dev.yml up -d`), a pointer to `docs/` and to `docs/features/README.md` (the plan + ledger). The full README is a launch deliverable (036/038) — keep the stub honest about status.

## Implementation notes

- Node LTS only (ADR-15). No experimental flags anywhere.
- .NET mapping: the workspace ≈ solution file; Turborepo task graph ≈ MSBuild project references; Changesets ≈ per-package NuGet versioning.

## Exit criteria

1. Fresh clone → `pnpm install && pnpm test` green; `docker compose -f docker-compose.dev.yml up -d` yields a healthy Postgres (the README promise).
2. CI green on the initial push.
3. `pnpm build` emits `dist/` + type declarations for all four packages.
4. A deliberate type error in any package fails root `pnpm typecheck`; a prettier violation fails `pnpm lint`. (Verify once, revert.)
5. `docs/features/README.md` ledger row 001 set to `done (PR #)` in the completing PR.

## Out of scope

Any runtime dependency, any schema, production Docker images, deploy workflows, git hooks (add later only if pain demands).
