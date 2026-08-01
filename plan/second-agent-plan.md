# Second dev agent: the issue lane (prepared 2026-08-01)

Code Owner direction: prepare a second autonomous dev agent that works the bug backlog (16 open bugs at time of writing) alongside the task loop, without touching the e2e chain's capacity. This document is the design and the runbook; the enabling changes landed with it (supervisor multi-lane flags, next-issue second-lane discipline).

## Shape

Two supervisors, two lanes, one merger:

| | Lane 1 (tasks) | Lane 2 (issues) |
|---|---|---|
| Supervisor | `scripts/agent-loop.sh` (defaults) | `scripts/agent-loop.sh -P /next-issue -M dev2` |
| Skill | `/next-task` | `/next-issue` |
| Claims | `feat/NNN-*` branches | issue claim comments + `fix/NN-*` branches |
| Merges | conducts its own (after PO sentinel + gates) | **never merges** - PRs land via the PO review loop |
| Seat mail | `../seat-mail/dev/` | `../seat-mail/dev2/` |
| Log | `agent-loop.log` | `agent-loop-dev2.log` |
| Sentinels | `NEXT-TASK:` | `NEXT-ISSUE:` (both parsed by the supervisor now) |

## Collision controls (all landed)

1. **Scope tier:** while 033/034/035 are executable, lane 2 picks `security`/`bug` issues only (the standing e2e-first aim).
2. **Footprint:** lane 2 skips issues overlapping the live task claim's apps/packages seam (checked against the claimed task file each selection).
3. **Machine load:** heavy suites (`verify:browser`, Docker force-runs) serialize across lanes via `flock ../seat-mail/.gates.lock` - two concurrent browser/Testcontainers runs is the documented load-flake recipe.
4. **Merge safety:** lane 2 never merges; the PO loop serializes all landings; the `protect-main` ruleset backstops everything.
5. **Mail isolation:** separate inboxes so act-then-move acks cannot race; both lanes write to `pm/` with `From:` lane signatures.

## First work for lane 2 (suggested order)

Verify-and-close candidates first (fixed by landed work, need confirmation + close): #220 (the 032 preview fix), #177 (032 made every page/action authenticate before the service token - confirm the route-handler class is covered and close or narrow). Then the destabilizers: #236 (portal settleTransitions race - it flakes a required check), #210 residue, #191, #165 (flaky cluster), #209 (false-green env leak), #182 (API error envelope), #186 (compiler heading sizes), #197 (invalid ?mode= fallback), #169 (rollback key restore), #156 (published subpath deps), #171, #154.

## Launch (Code Owner go required)

```bash
cd /workspaces/qcms
mkdir -p ../seat-mail/dev2/read
nohup bash scripts/agent-loop.sh -P /next-issue -M dev2 -r 15 -m 25 >/dev/null 2>&1 &
```

Watch: `tail -F agent-loop-dev2.log`. The PO seat's monitors already cover `pm/` mail and PR/CI transitions, so lane-2 PRs enter the same review pipeline automatically.

## Rollback

Kill the lane-2 supervisor process; any in-flight issue parks on its `fix/NN-*` branch with its claim comment, and the next start (or lane 1's crossover) recovers it. Nothing about lane 1 changes.

## Revisit at 035

When the e2e chain completes, the scope tier widens (enhancements eligible), the enrichment cluster (048/049/057/058/041) opens real task parallelism, and the choice between "lane 2 keeps issues" vs "`/next-task 2` under lane 1" gets made on observed throughput.
