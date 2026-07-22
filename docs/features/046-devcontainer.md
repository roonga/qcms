# 046 - Dev container as the canonical dev environment

**Stage:** tooling / infra - **off the launch gate** · **Apps/packages:** repo-root `.devcontainer/`, `scripts/`, contributor docs · **Depends on:** 029, **045** (its portal e2e is this task's acceptance test)
**Runs:** after 045 lands and `main` is clean (the migration must not move the environment under a running 045). Numbered out of sequence - see `features/README.md`.
**References:** ADR-29 (proposed 2026-07-23, pending Ravi's decision - this task implements it) · ADR-23 (Testcontainers e2e/db) · ADR-22 (`a2-react-aria` sibling repo, tasks 011/028) · ADR-20 (four-container solo topology; shares a base with 036) · `scripts/agent-loop.ps1` · `docker-compose.dev.yml` · dev ports 7xxx (portal 7000 / API 7010 / Postgres 7020).

## Context

Windows-isms keep leaking into a project meant to ship cross-platform (`git.exe` vs `git`, `pnpm.cmd` EINVAL, PowerShell path-token/`$env` traps, docker-credsStore, orphaned worktree dirs). Separately, the autonomous loop wants `--permission-mode bypassPermissions` without prompt-tuning, which is only safe with real isolation. A Dev Container solves both and gives every contributor (any OS, incl. Codespaces) a one-click preinstalled environment. ADR-29 records the decision and its trade-off (Testcontainers reaches Docker via a mounted host socket - `docker-outside-of-docker` - which re-widens the blast radius slightly; acceptable on a solo/trusted machine).

## Deliverables

- **`.devcontainer/devcontainer.json`:** single-container `image` (Ubuntu 24.04 base) + Features - node 24, `docker-outside-of-docker` (for Testcontainers), `github-cli`, `powershell`; `forwardPorts` aligned to the **7xxx** dev ports; `a2-react-aria` sibling bind-mount (ADR-22); `postCreate` = corepack + `pnpm install --frozen-lockfile` + `npx playwright install --with-deps chromium`. Reuses `docker-compose.dev.yml` for the dev DB; does **not** adopt the `javascript-node-postgres` template (it bundles a long-lived Postgres qcms does not use - Testcontainers is ephemeral).
- **`scripts/agent-loop.sh`:** canonical bash supervisor mirroring `agent-loop.ps1`; the `.ps1` stays for Windows-host fallback (decision B).
- **Host-browser viewing:** portal/admin/`dev:portal` dev servers bind `0.0.0.0` inside the container so the forwarded 7xxx ports are reachable from the host browser (the agent screenshot gate uses headless Playwright *inside* the container; `claude-in-chrome` stays host-side).
- **Windows-ism audit actions:** keep the cross-platform guards (`git.exe` shim, PowerShell permission families, the `/next-task` orphaned-worktree sweep - all no-ops on Linux); review the `@qcms/db` docker-credsStore/anonymous-pull workaround inside the container and simplify only if verified (guarded for Windows otherwise); reframe CLAUDE.md/memory PowerShell-trap notes as host-Windows-only.
- **Contributor docs:** `CONTRIBUTING.md` (Development environment section - container is the recommended path), `README.md` (Open-in-Codespaces badge + one line), `docs/DEVELOPER_GUIDE.md` (container launch path alongside host).
- **Secrets provisioned at runtime, never committed:** `gh` auth, `QCMS_*` via mounted `.env`/host env (`.env.example` stays the only committed env file), `~/.claude` mount. No secret value in `devcontainer.json` or any committed file.

## Exit criteria

1. `devcontainer up` builds clean; `pnpm install --frozen-lockfile` succeeds inside.
2. **Full merge gate green *inside the container*:** `pnpm build && pnpm typecheck && pnpm test && pnpm lint`, especially the `@qcms/db` + api **Testcontainers** suites (document the `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` fallback if sibling-container reachability needs it) plus the CI check-gates.
3. **045's portal e2e passes inside the container** - the kitchen-sink full flow across the 3 viewports with the independent Postgres verification and browser + container-log gates. This is the migration's real acceptance test. Host-browser view of the running app over the forwarded 7xxx ports works (0.0.0.0 bind verified).
4. A throwaway `/next-task` dry run in `bypassPermissions` completes with **zero prompts** (decision C).
5. **Additive + reversible:** the host workflow is untouched (`pwsh scripts/agent-loop.ps1` still runs on the host); `.devcontainer/` is purely additive; rollback documented. Windows-host support retained (decision D).

## Out of scope

Production images/compose (036 - shares the Ubuntu/node base but is a separate task); baking a `build.dockerfile` (add later if we want more preinstalled); a Codespaces prebuild config for faster cold starts; **relocating the dev-loop repos into the WSL2 filesystem** (decision A - a host setup step Ravi performs, documented not automated). No change to product code beyond the `0.0.0.0` dev-server bind.
