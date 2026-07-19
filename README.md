# qcms — Question CMS

An MIT-licensed, TypeScript, open-source engine for questionnaires, surveys, and registration flows with deeply conditional logic — the answer to one question determines which questions follow. Distributed in the shadcn ethos: you scaffold the app and own the source; the invariant machinery ships as versioned `@qcms/*` packages.

> **Status: bootstrap (task 001).** The monorepo toolchain skeleton is in place; the packages contain placeholders only. The full README is a launch deliverable (tasks 036/038).

## Quickstart

```sh
pnpm install && pnpm test
docker compose -f docker-compose.dev.yml up -d   # dev Postgres (copy .env.example to .env first)
```

## Documentation

- Plan and progress ledger: [`docs/features/README.md`](docs/features/README.md)
- Driving the agentic workflow (human guide): [`docs/USING_THE_AGENTS.md`](docs/USING_THE_AGENTS.md)
- Read-first for contributors and agents: [`PROJECT_INSTRUCTIONS.md`](PROJECT_INSTRUCTIONS.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Architecture and decisions: [`docs/`](docs/) — [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`PROJECT_GOAL.md`](docs/PROJECT_GOAL.md) (ADR-01…25)
