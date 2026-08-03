# QCMS

**QCMS** (Question CMS) - an MIT-licensed, TypeScript engine for questionnaires, surveys, and registration flows with **deeply conditional logic**, where the answer to one question determines which questions follow.

> ### ⚠️ Pre-release - under active development
>
> QCMS is being built in the open and is **not ready for production use**. APIs, schemas, storage shapes, and packages are pre-1.0 and **may change without notice**. It has not yet passed its pre-launch security review, and must not be used for real respondent data. Follow along; don't depend on it yet.
>
> **Build progress:** [`docs/features/README.md`](docs/features/README.md) - the task ledger and current stage.

---

## What it is

QCMS is distributed in the **shadcn ethos**: you don't install a product, you scaffold the application into your own repository and own the source. The invariant machinery - domain model, rules engine, publish compiler, migrations - ships as versioned `@qcms/*` npm packages you upgrade like any dependency.

Three properties are non-negotiable and shape every design decision:

- **Immutability** - published form versions are frozen forever; a session pins the version it started on and never migrates.
- **Determinism** - the serving path contains no LLM and nothing nondeterministic. Same form version + same answers = same flow and same UI, forever.
- **Auditability** - the system can always answer *what was asked, what was shown, what was answered, and when it changed.* Snapshots store both the domain definition and the compiled UI; answers are an append-only ledger.

Accessibility (WCAG 2.2 AA) is a first-class commitment, built in and verified per release - not a bolt-on.

## Repository layout

```
packages/
  core/            @qcms/core          - domain model, rules DSL + evaluator, publish compiler, tokens (pure, zero I/O)
  a2ui-compiler/   @qcms/a2ui-compiler - FormDefinition → A2UI documents; the agent seam
  db/              @qcms/db            - Drizzle schema, migrations, query helpers, reporting view, erasure
  ui/              @qcms/ui            - the A2UI renderer, built on a2-react-aria
apps/
  api/             Hono - vertical slices, fetch-pure handlers
  portal/          Next.js - SSR respondent experience (public)
  admin/           Next.js - authoring, versioning, responses (VPN/internal)
```

The domain kernel (`@qcms/core`) is a functional core: pure functions over immutable data, no I/O. Code whose modification would break audit or versioning guarantees ships as a versioned package; code an adopter would reasonably change (routes, pages, theming) is scaffolded, owned source.

## Development

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/roonga/qcms)

The **dev container** in `.devcontainer/` is the recommended environment (ADR-29): Node 24, pnpm, Docker access, the GitHub CLI and Playwright's Chromium, preinstalled. Open the repo in VS Code and *Reopen in Container*, click the badge above for a Codespace, or run `pnpm devcontainer up` from a terminal. Full guide: [`docs/DEV_CONTAINER.md`](docs/DEV_CONTAINER.md).

Working on the host instead is fully supported. Requires [Node](https://nodejs.org) (LTS, see `.nvmrc`), [pnpm](https://pnpm.io), and Docker (for the integration test database).

```sh
pnpm install
pnpm build && pnpm test        # kernel, compiler, db (Testcontainers), api
pnpm verify                    # the full merge gate: the above plus typecheck, lint, and every check:*
docker compose -f docker-compose.dev.yml up -d   # local Postgres - copy .env.example to .env first
```

Details, including how to reach the dev database from inside the container: [`CONTRIBUTING.md`](CONTRIBUTING.md#development-environment).

### Run the complete stack with Docker Compose

The solo Compose topology runs Postgres, an explicit one-shot migration, the API,
the respondent portal, and the authoring admin. The API and database are internal
to the Compose network; only the two web apps publish host ports.

```sh
cp .env.compose.example .env  # replace every placeholder secret before use
docker compose up --build -d
```

At the default ports, open the portal at `http://localhost:17000` and the admin
at `http://localhost:17040`. The migration runs once before the API starts; it is
not performed by application startup, so operators retain control of upgrade
ordering. For an internet-facing deployment, place TLS ingress in front of these
two apps only; never publish the API or Postgres ports.

To run the browser end-to-end flow in an isolated Compose project:

```sh
pnpm docker:up
pnpm test:e2e
pnpm docker:down
```

`pnpm docker:up` first deletes any previous test containers and volumes, then starts
a fresh stack on ports `17900` (portal) and `17940` (admin) and bootstraps a new
admin with generated credentials (printed once to the terminal). `pnpm test:e2e`
completes required TOTP enrollment and confirms access to the Questions screen.
Use `pnpm test:e2e:headed` to watch the browser while that stack remains running.

For a self-contained run that starts the stack, executes the same suite, and
cleans up automatically, use `pnpm up:e2e`; add `:headed` to watch that run.

The **Compose E2E** GitHub Actions workflow can also be run manually from the
Actions tab: choose the workflow, select **Run workflow**, and choose the branch.
From a terminal with GitHub CLI authentication, run:

```sh
gh workflow run e2e.yml --ref <branch>
```

Each run keeps the Compose startup, browser-flow, and teardown logs in separate
steps and uploads the Playwright HTML and JUnit report as `compose-e2e-report`.

## Documentation

- [`docs/PROJECT_GOAL.md`](docs/PROJECT_GOAL.md) - vision, scope, and the architectural decision records (ADR-01…35)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - system design and repository structure
- [`docs/DOMAIN_SCHEMA.md`](docs/DOMAIN_SCHEMA.md) - the domain model, rules DSL, and invariants
- [`docs/SECURITY_DESIGN.md`](docs/SECURITY_DESIGN.md) - threat model and security controls (SEC-1…13)
- [`docs/features/`](docs/features/) - the numbered task plan and progress ledger

## Contributing

QCMS is built with an agentic development workflow. **External pull requests are not being accepted yet** (pre-release) - but **issues, bug reports, and discussion are very welcome**. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for standards and [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) for the development flow. Security issues: follow [`SECURITY.md`](SECURITY.md) - never a public issue.

## License

[MIT](LICENSE) © 2026 Roonga and the QCMS contributors.
