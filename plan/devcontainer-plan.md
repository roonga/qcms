# Plan: Dev Container as the canonical dev environment (proposed ADR-27)

**Status:** proposal for Ravi's review. Commit the artifacts (ADR-27 + `.devcontainer/` + doc updates) into the repo **when 029 is done and pushed**, then switch the loop over. Nothing here changes the running 029 task.

Three goals, one change:
1. Run the **autonomous dev loop** in a container with `bypassPermissions` (no more permission-prompt tuning).
2. Make **Linux the canonical dev environment** so we stop fighting Windows-isms and new code is not written against them.
3. Give **future contributors** (any OS, including Codespaces) a one-click, preinstalled environment.

## 1. Decision (ADR-27, draft)

Adopt a **Dev Container** (containers.dev spec; plain Docker underneath) as the canonical environment for both the agentic loop and human contributors. The autonomous loop runs inside it with `--permission-mode bypassPermissions`; the container is the blast radius, so full autonomy is safe. The product build, gates, and Testcontainers suite all run inside it. The product-owner seat stays on the host.

## 2. Why (and the trade-off recorded)

- Isolation makes `bypassPermissions` acceptable: zero prompts, true unattended runs.
- Linux erases the Windows-isms this project keeps hitting (`git.exe` vs `git`, `pnpm.cmd` EINVAL, PowerShell `$env`/path-token traps, docker-credsStore).
- One environment for every contributor on every OS; enables free GitHub Codespaces onboarding.
- Shares a base with task 036 (production images / compose); not a detour.
- **Trade-off (recorded honestly):** the merge gate boots real Docker Postgres per test file (Testcontainers, ADR-23). The container reaches Docker via a mounted host socket (`docker-outside-of-docker`), spinning *sibling* containers on the host. This re-widens the blast radius slightly (the container can drive host Docker). Acceptable on a solo/trusted machine; noted so it is a decision, not an accident.

## 3. Which base? (answering the javascript-node-postgres template question)

The `devcontainers/templates/.../javascript-node-postgres` template is a **docker-compose** with a node app service + a long-lived Postgres service. It does **not** fit qcms cleanly:
- qcms tests use **Testcontainers** (ephemeral Postgres per test file via Docker), not a shared long-lived DB. The template's bundled Postgres is not what the suite uses.
- Testcontainers needs **Docker access** regardless, which that template does not provide.
- qcms already has `docker-compose.dev.yml` for the dev DB. Adding the template's Postgres makes a *third* Postgres concept (template's, compose.dev's, Testcontainers' ephemeral).

**Recommendation: a single-container `image` + Features devcontainer** (below). It reuses the existing `docker-compose.dev.yml` for the dev DB, gets Docker for Testcontainers via the socket Feature, and avoids compose orchestration for the container itself. The template is a fine reference, not a wholesale adopt.

## 4. The `.devcontainer/devcontainer.json` (concrete)

```jsonc
{
  "name": "qcms-agentic-dev",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu-24.04",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "24" },
    "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/powershell:1": {}
  },
  "workspaceFolder": "/workspaces/qcms",
  // Forward the app dev ports to the host so you view the live app in your host browser.
  // Match these to whatever portal/admin/api actually bind (align with docker-compose.dev.yml).
  "forwardPorts": [3000, 3001, 8787],
  "mounts": [
    // a2-react-aria sibling repo: the co-evolution contract (ADR-22, tasks 011/028)
    "source=${localWorkspaceFolder}/../a2-react-aria,target=/workspaces/a2-react-aria,type=bind,consistency=cached"
  ],
  "postCreateCommand": "corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile && npx playwright install --with-deps chromium",
  "remoteUser": "vscode",
  "runArgs": ["--init"]
}
```

- `docker-outside-of-docker` mounts the host socket so Testcontainers works.
- `powershell` Feature keeps `scripts/agent-loop.ps1` runnable unchanged (see open decision B).
- Playwright browsers installed headless for the screenshot gate (use the headless Playwright MCP, not `claude-in-chrome`, which is host-side).
- No Dockerfile needed yet; add `build.dockerfile` later if we want more baked in.

## 5. Removing / canonicalizing Windows-isms

Goal is not to drop Windows *support* (contributors may be on any OS) but to make Linux the tested, canonical path so quirks stop leaking in. Audit:

| Windows-ism | Action |
|---|---|
| `scripts/agent-loop.ps1` (PowerShell supervisor) | Add canonical **`scripts/agent-loop.sh`** (bash); keep `.ps1` for Windows-host fallback. This is the one real port. |
| `const GIT = win32 ? "git.exe" : "git"` in `scripts/check-*.mjs` | **Keep** - it is correct cross-platform code, harmless on Linux, needed for Windows-host contributors. Not a wart. |
| `PowerShell(...)` permission families in `.claude/settings.json` | **Keep** - harmless on Linux; helps Windows-host contributors. |
| docker-credsStore workaround / anonymous-pull forcing in `@qcms/db` testing | **Review** inside the container - may be unneeded on Linux Docker; simplify only if verified, guarded for Windows otherwise. |
| Orphaned worktree dirs (`git worktree remove` leaves folders on Windows) + the `/next-task` self-heal sweep (commit 16045ea) | **Keep the sweep** - it is cross-platform-safe and a **no-op on Linux**. The *cause* (remove failing to delete the folder) does not occur on Linux, so the container removes the failure at the root while the sweep stays as a harmless backstop. One more Windows papercut the container erases. |
| CLAUDE.md / memory notes about PowerShell path-token traps | Reframe as "host-Windows only; the container is Linux" once the container is canonical. |

Net: one new bash supervisor, a review of the db-testing workaround, and doc reframing. Cross-platform guards stay.

## 6. Contributor-facing GitHub instructions (public repo)

- **`CONTRIBUTING.md`**: add a "Development environment" section - the dev container is the recommended path ("Open in a container / Codespaces; Node 24, pnpm, Docker, gh, Playwright preinstalled; run `pnpm build && pnpm test && pnpm lint`"). Note the pnpm-only + gate rules already there.
- **`README.md`**: an "Open in GitHub Codespaces" badge + one line pointing devs at the container. (Pre-release banner stays; external PRs still not accepted yet, but the environment is ready for when they are.)
- **`docs/DEVELOPER_GUIDE.md`**: add the container launch path alongside the host path.
- Optional: `.devcontainer` enables Codespaces automatically; add a prebuild config later if we want faster cold starts.

## 7. Secrets and env (never committed)

Provisioned at runtime, not in `devcontainer.json`: `gh` auth (`GITHUB_TOKEN` or a mounted `gh` config), npm token (`NPM_TOKEN` -> generated `.npmrc`, only if publishing), `QCMS_*` via mounted `.env` or host env (`.env.example` stays the only committed env file), and Claude auth via mounted `~/.claude`.

## 8. Launching the loop inside

```bash
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . ./scripts/agent-loop.sh      # or pwsh scripts/agent-loop.ps1
# interactive:  devcontainer exec ... claude --permission-mode bypassPermissions  then /loop /next-task
```

### Viewing the running app in your host browser

You do **not** open a browser from *inside* the container (separate Linux namespace, no host GUI). You view the app that runs inside it from your **host** browser via **port forwarding**:
- The forwarded ports (`forwardPorts` above; VS Code also auto-detects listening ports and offers "Open in Browser") make the container's `localhost:3000` reachable at `http://localhost:3000` on the Windows host. Open it in any host browser.
- **The dev server must bind `0.0.0.0`** inside the container (e.g. `next dev -H 0.0.0.0`), not just `127.0.0.1`, or the forward has nothing to reach. Wire that into the portal/admin dev scripts.
- Keep the two browser roles separate: **human viewing = host browser on the forwarded port; agent screenshot gate = headless Playwright *inside* the container** (writes image files, no host browser). The one thing that will **not** work in the container is the `claude-in-chrome` MCP - it drives your real host Chrome and cannot reach into the container - which is exactly why the gate uses headless Playwright.

## 9. Open decisions (need your call)

- **A. Repo location / performance.** Bind-mounting a Windows path (`H:\...`) over the WSL2 boundary is slow for heavy pnpm/test I/O. Best perf = clone the repos into the **WSL2 filesystem** and open the container from there. My rec: **relocate the dev-loop repos into WSL2**; the PO seat can stay on the Windows checkout.
- **B. Supervisor.** `powershell` Feature keeps `agent-loop.ps1` (zero rewrite) vs a canonical bash `agent-loop.sh`. My rec: **write `agent-loop.sh` as canonical** and keep `.ps1` for Windows-host fallback (small port, cleaner Linux story).
- **C. Autonomy.** `bypassPermissions` (the point) vs `acceptEdits` in-container. My rec: **`bypassPermissions`**.
- **D. Windows-host support.** Keep it (cross-platform guards stay, `.ps1` retained) vs Linux-only. My rec: **keep cross-platform**; the container is canonical but the repo stays OS-agnostic for open-source contributors.

## 10. Verification (acceptance before trusting it)

Riskiest piece is Testcontainers-through-a-mounted-socket, so that is the gate:
1. `devcontainer up` builds clean; `pnpm install --frozen-lockfile` succeeds.
2. **`pnpm build && pnpm typecheck && pnpm test && pnpm lint` green *inside the container*** - especially the `@qcms/db` + api Testcontainers suites. If testcontainers cannot reach its sibling containers, set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` (documented fallback) and re-verify.
3. The four check-gates pass.
4. A throwaway `/next-task` dry run in `bypassPermissions` completes with zero prompts.

## 11. Rollback

Host workflow is untouched and remains the fallback (`pwsh scripts/agent-loop.ps1` on the host). `.devcontainer/` is additive; nothing is removed.

## 12. Switch checklist (run when 029 is pushed)

- [ ] 029 landed on main, tree clean
- [ ] Ravi's calls on A/B/C/D recorded
- [ ] Commit ADR-27 (`docs/PROJECT_GOAL.md`), `.devcontainer/`, `agent-loop.sh`, CONTRIBUTING/README/DEVELOPER_GUIDE updates
- [ ] `devcontainer up` + run the §10 verification (Testcontainers included)
- [ ] Kick the loop in `bypassPermissions`; watch the first task end-to-end
- [ ] Update memory + docs with any host-override/setup gotchas found
