# CI-outage protocol: landing work on local gates while GitHub Actions is down

**Status: ACTIVE, opened 2026-08-06 21:40Z.** Standing instruction from the Code
Owner: "bypass GH Actions with local checks until this resolves."

**This document retires the moment Actions is operational and one clean CI run has
concluded on `main`.** It is a temporary substitution of evidence, not a change to
the merge gate. The bar does not move: the same four checks must pass, they just
pass on this machine and get recorded by hand instead of by a bot.

## The situation

GitHub Actions has been in a **major outage** since ~15:22Z on 2026-08-06 (still
`major_outage`, incident *investigating*, at 21:30Z). `push` and `pull_request`
events stopped creating workflow runs entirely. `workflow_dispatch` still
dispatches, but runner capacity is constrained and dispatched jobs time out.

Practical effects on this repo:

- `main` has **no check runs at all** for `f02801a` (056) and `aea47d9` (#285).
  Last complete CI on `main` was `cd91ab5` at 09:18Z.
- PR #320 was merged at 20:53Z on substituted evidence, with the rationale posted
  on the thread. That is the precedent this document generalises.
- A PR with no checks reports `BLOCKED`. That is the required-contexts rule working
  correctly against an empty check set, **not** a verdict on the branch.

## What `protect-main` actually requires

Ruleset `protect-main` (id 19714021), enforcement `active`, **bypass actors: none**.
Required contexts, exactly four:

`verify (node-24)` · `api-e2e` · `portal-e2e` · `full-stack-e2e`

Also enforced: squash-only, linear history, no deletion, no force-push. Those stay
untouched. Only the status-check requirement is being substituted.

## The substitution table

Run every one of these from a **worktree** off the head being merged, after
`pnpm install` (the lockfile moves often; skipping it produces a wall of `TS2307`
that reads exactly like the branch's own breakage).

| Required context | Local equivalent | Notes |
|---|---|---|
| `verify (node-24)` | `pnpm verify` | Root. Must be exit 0. |
| (same, evidence leg) | `pnpm exec turbo run test --force` | **Mandatory second run.** See the cache trap below. |
| `api-e2e` | `pnpm --filter qcms-api exec vitest run --root ../.. --project qcms-api-e2e` | |
| `portal-e2e` | `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` | Budget 12-15 min, not the ~2 the docs still claim (#299). |
| `full-stack-e2e` | `pnpm docker:up` then `pnpm test:e2e` then `pnpm docker:down` | **Currently blocked from the dev container - see below.** |

**The cache trap, which is the whole reason for the second leg.** Turbo resolves to
the main checkout's `.turbo/cache`, so a fresh worktree routinely reports the entire
test phase as `14/14 cached, FULL TURBO`. A green `verify` is therefore not by
itself evidence that its tests ran. The force-run must say **`0 cached`** and that
line gets quoted in the evidence block. Note `pnpm test --force` does **not** do
this: pnpm appends the flag to the end of the chained script, so `test:tooling` dies
on `CACError: Unknown option --force` while the turbo leg still runs unforced.

**Seat discipline, and a warning that is now load-bearing.** Every run takes a
`QCMS_PORT_SEAT` per `docs/PORTS.md` (R8/ADR-37). But the seat allocation separates
**ports, not CPU**: two lanes on different seats never collide on a port, never trip
`check:ports`, and still starve each other. That produced a false red on 048 today
(one test at 22.5s against 8.9s isolated, load average above 8, 23 live test
processes in one lane and 12 in another). **Under this protocol, browser suites run
one at a time.** Check `uptime` and count live test processes before starting.

## The gap: `full-stack-e2e` cannot currently be substituted

Issue **#316**: `apps/e2e/support/full-stack-config.ts` hardcodes `localhost`, but a
compose-published port lands on the **host's** loopback, so from inside the dev
container there is nothing there. The stack comes up healthy and the suite still
dies in `beforeAll` with `ECONNREFUSED`. `scripts/dev-portal.mjs` already resolves
the default-route gateway for exactly this reason, 200 lines away.

So one of the four required contexts has **no local equivalent from the canonical
dev environment** while this protocol is in force. That is not tolerable for the
duration: it is the only check that catches a container-level regression, and 056 -
which moved authentication between processes - is precisely the class of change it
exists to catch.

**Therefore #316 is the first work item under this protocol**, ahead of feature
work. It converts the last un-substitutable check into a local one. Until it lands,
a PR whose blast radius reaches the composed topology (auth, config, env plumbing,
compose files, ingress) **does not merge under substitution** - it waits for Actions
or for #316, whichever arrives first. A PR that cannot reach the composed topology
may merge with that context recorded as `NOT REPRODUCIBLE (#316)` and an explicit
one-line argument for why the change cannot affect it.

## Merging under substitution

The ruleset has **zero bypass actors**, so the only door is the repository-admin
override: `gh pr merge <N> --squash --admin`.

**While this protocol is active, the PM seat performs every merge**, including task
PRs the dev conductor would normally merge itself. One pair of hands on the override
means one audit trail. The dev seat's conductor stops at "ready to merge" and mails
the PM seat instead.

Sequence for each PR:

1. Dev seat posts a **CI-SUBSTITUTION evidence block** on the PR (format below).
2. PM seat verifies the evidence at the **current head SHA** - a rebase invalidates
   it, exactly as it invalidates a sentinel.
3. PM seat posts `PO-REVIEW: APPROVE @<headRefOid>` with `CI-SUBSTITUTED` on its own
   line and the outage reference.
4. PM seat merges with `--admin`.

### Evidence block format

```
CI-SUBSTITUTION @<full head SHA>
GitHub Actions major outage from 2026-08-06 15:22Z; no runs created by push events.

verify (node-24)   pnpm verify                          exit 0
  test leg forced  turbo run test --force               0 cached, 14 total
api-e2e            vitest --project qcms-api-e2e        exit 0, NN passed
portal-e2e         verify:browser (seat N)              NNN passed / NN skipped / 0 failed
full-stack-e2e     <result, or NOT REPRODUCIBLE (#316) + why unreachable>

Machine state: load average X.XX, no other lane running a suite.
Re-rolls: <none, or exactly what was re-run and why>
```

A re-roll gets stated, never buried. The standing bar holds: a suite is re-rolled
**once**, not until green, and a second failure at the same point is handed to a
human read rather than absorbed.

## What is NOT substituted, and the backfill debt

`CodeQL` and the `audit` workflow are not required contexts and have no local
equivalent here. Anything merged under substitution therefore carries **unrun
security scanning**. That debt is tracked here and discharged when Actions returns.

**On recovery, in this order:**

1. Confirm `main` gets a full CI run. `ci.yml` triggers on `push`/`pull_request` and
   has **no `workflow_dispatch`**, so a run on `main` cannot be requested on demand -
   it arrives with the next merge. Until then `main` stays formally unverified.
   *(Proposal to the Code Owner: add `workflow_dispatch:` to `ci.yml`. It costs one
   line and removes this whole class of helplessness. `e2e.yml` already has it,
   which is how a check on the 056 head was obtained during the outage.)*
2. Re-run CodeQL over `main` and read it before anything else lands.
3. Retire this document and note the substituted merges in `docs/RETRO.md`.

## Ledger of merges made under substitution

| PR | Head | Merged | Contexts substituted | Backfilled |
|---|---|---|---|---|
| #320 (056) | `a8a8e396` | 2026-08-06 20:53Z | all four | no |

Append a row per merge. Nothing leaves this table until CI has run over `main` at or
above that commit.
