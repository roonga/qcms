# Windows-ism audit (2026-07-25)

Context: the dev machine moved from Windows host to WSL2 Ubuntu; the devcontainer (ADR-29, task 046, in flight) makes Linux the canonical environment. This audit sweeps the tree for Windows-specific code, config, docs, and memory, and triages each into: keep (correct cross-platform guard), covered by 046, fixed now, or owner decision.

Scope: main + `feat/046-devcontainer`, `.claude/` harness config, `plan/` seat files. CI (`.github/`) is Linux-only already - no findings.

## 1. Keep - correct cross-platform guards (no action)

| Where | What | Why keep |
|---|---|---|
| `scripts/check-no-em-dash.mjs:23`, `scripts/check-no-control-chars.mjs:25` | `const GIT = win32 ? "git.exe" : "git"` | Platform-gated, no-op on Linux; needed by Windows-host contributors. |
| `scripts/dev-portal.mjs:108,165,178,286,350` | `IS_WINDOWS` shell spawns + `taskkill /T` tree-kill | Platform-gated; Linux path uses `SIGTERM`. Correct on both. |
| `packages/db/src/testing/docker-auth-config.ts` | docker-credsStore workaround | 046 verified it is a no-op in-container and kept it for the Windows host (comment updated on the branch). |
| `/next-task` orphaned-worktree sweep | housekeeping in SKILL.md | OS-neutral. |

## 2. Covered by 046 (verify at review, not re-done here)

- `scripts/agent-loop.sh` - canonical bash supervisor. (Originally paired with a retained `.ps1` fallback under ADR-29 decision B; superseded by D1 below - the `.ps1` is retired.)
- `docs/DEVELOPER_GUIDE.md` - dual launch paths (Windows host or WSL2), container-first framing, Windows-fallback section. (The 046 resume also makes the clone-path examples location-agnostic - no assumed parent folder; issue #40.)
- `CONTRIBUTING.md`, `README.md`, `docs/RETRO.md`, root `CLAUDE.md` - container-canonical reframing.
- Outstanding on that branch: `--model claude-opus-5` pin for the `agent-loop.sh` orchestrator (issue #40).

## 3. Fixed in this change (plan/ seat files)

- `plan/CLAUDE.md` - dev-loop launch path now names `agent-loop.sh` (devcontainer) with `.ps1` as Windows-host fallback; repo-root and component-library paths de-Windowsed (relative / dual).
- `plan/memory/filesystem-scope-boundary.md` - scope boundary restated for all three mounts (Windows host, WSL2, devcontainer `/workspaces`).
- `plan/memory/a2ra-repo-notes.md` - broken-turbo note marked host-Windows-only (0xC0000135 is a Windows loader error; does not apply on Linux).
- `plan/memory/MEMORY.md` - index lines updated to match.
- (`qcms-conductor-traps.md` was already flagged host-Windows-only in the index - left as is.)

## 4. Owner decisions (open)

**D1 - fate of `scripts/agent-loop.ps1` and its support surface. DECIDED 2026-07-25: retired** (Code Owner). ADR-29 decision B amended in PR #42; the 046 resume executes the removals (the `.ps1` itself, the `powershell` Feature in `.devcontainer/devcontainer.json`, the 16 `PowerShell(...)` permission rules in `.claude/settings.json` incl. the deny mirrors, Windows-fallback doc sections) - scope recorded on issue #40.

**D2 - `docs/PRODUCT_OWNER.md:3` was stale** (still seated the PO at the archived `qcms-plan` checkout). **FIXED in PR #43** along with the Code Owner name sweep.

## WSL2 parity check (the "same for wsl2" question)

| Capability | Windows host | WSL2/container | Status |
|---|---|---|---|
| Loop supervisor | `scripts/agent-loop.ps1` | `scripts/agent-loop.sh` (046 branch) | parity when 046 merges |
| git resolution in check scripts | `git.exe` shim | plain `git` | ok today |
| Permission allowlist | `PowerShell(...)` families | `Bash(...)` families | both present in `.claude/settings.json` |
| Process-tree teardown (`dev-portal.mjs`) | `taskkill /T` | `SIGTERM` | ok today |
| Docker credsStore guard | active | verified no-op | ok (046) |
| Dev-loop model pin | n/a (`.ps1` unpinned, out of scope) | issue #40 on `agent-loop.sh` | pending 046 |

Bottom line: nothing on Linux is missing a Windows-only capability; the gaps run the other way (046 merge + D1/D2).
