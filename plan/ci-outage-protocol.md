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
| `full-stack-e2e` | `pnpm docker:up` then `pnpm test:e2e` then `pnpm docker:down` | **Not reproducible from the dev container at all, and not a one-line fix - see below.** |

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

## The gap: `full-stack-e2e` cannot be substituted, and it is not a one-line fix

Issue **#316** reports that the full-stack suite cannot run from the dev container.
A verification run against `aea47d9` on 2026-08-06 **confirmed the fact and corrected
the diagnosis**: #316 names one cause, in a file that is dead code on this path.
There are three, stacked, and each is only visible once the one above it is removed.

**Layer 1 - the `localhost` is not where #316 says.** #316 points at
`apps/e2e/support/full-stack-config.ts:23,27`. Those are `??` fallbacks and are
never consulted on the `pnpm test:e2e` / `pnpm up:e2e` path, because
`scripts/compose-e2e.mjs:59-60` exports `QCMS_ADMIN_BASE_URL` and
`QCMS_PORTAL_BASE_URL` as `http://localhost:<port>` into the runner's environment.
**Editing `full-stack-config.ts` alone changes nothing at all.**

**Layer 2 - the gateway address is refused too, by design.**
`docker-compose.yml:95,121` publishes `${QCMS_BIND_ADDRESS:-127.0.0.1}:<port>:3000`
and `.env.compose.example:44` pins `127.0.0.1`. Proven with the stack up and every
container healthy: `localhost`, `127.0.0.1` and the `172.17.0.1` gateway all refuse.
Rebinding to `0.0.0.0` makes the gateway answer `200`/`307`. So the gateway
resolution #316 asks for is **necessary but insufficient**.

This is also why `scripts/dev-portal.mjs`'s gateway trick works for the database and
would not work here: `docker-compose.dev.yml:23` publishes Postgres as a bare
`"7020:5432"`, which binds `0.0.0.0`. The full-stack file deliberately does not, and
`docker-compose.yml:12-17` says why - a bare publish puts the authoring admin on
every network the host can reach, ahead of the host firewall. **That exposure
property is real and is not to be traded away to fix a test harness.**

**Layer 3 - `Secure` cookies require a trustworthy origin, and a gateway IP is not
one.** With layers 1 and 2 removed, the suite still fails, differently: sign-in
redirects to `/sign-in?error=1` and the API log shows **no sign-in POST ever
arrived**. The same POST by `curl` against the same container returns
`303 -> /two-factor/enroll` with both cookies correct. `.env.compose.example:58`
leaves `QCMS_ADMIN_SECURE_COOKIES` unset, so it falls back to `NODE_ENV`, true in
the image, and the cookies carry `Secure` and the `__Secure-` prefix. Chromium
accepts those over `http://localhost` and **rejects them over `http://172.17.0.1`**,
so nothing is stored and the enrol route bounces straight back.

### The constraint any fix must satisfy

The obvious repair - gateway address, bind `0.0.0.0`, and
`QCMS_ADMIN_SECURE_COOKIES=false` for the in-container case - works, but it means a
local full-stack run exercises a **different cookie configuration than CI**. That
makes local green weaker evidence than CI green for precisely the auth-boundary
properties task 056 just moved between processes, which is the one thing this check
exists to catch.

**So: no fix for #316 may weaken the fidelity of the local run relative to CI.**
The route that satisfies this is the one that keeps the browsed origin on
`localhost`, so `Secure` cookies stay on and neither the bind address nor the cookie
config diverges: forward the harness ports into the dev container's own loopback
(a listener on `127.0.0.1:17S00`/`17S40` inside the container, forwarding to the
compose services), rather than teaching the runner to browse a foreign address.
That option is to be costed before the three-change route is adopted.

### Consequence while the gap stands

One of the four required contexts has **no faithful local equivalent** from the
canonical dev environment (ADR-29). Therefore:

- A PR whose blast radius reaches the composed topology (auth, config, env plumbing,
  compose files, ingress, session/cookie handling) **does not merge under
  substitution.** It waits for Actions, or for a #316 fix that meets the constraint
  above.
- Any other PR may merge with the context recorded `NOT REPRODUCIBLE (#316)` plus an
  explicit one-line argument for why the change cannot affect the composed topology.
  The argument is written down, not assumed.

Note also that `check:changeset` and `check:golden-append-only` diff against
`origin/main`, so on a **push to `main`** their diff basis is `main` itself. They are
PR gates and assert nothing about a merge commit, in either environment. Do not read
them as evidence for a commit already on `main`.

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

## Retrospective verification of `main` at `aea47d9` (2026-08-06 22:10Z)

`f02801a` and `aea47d9` reached `main` with no checks at all. The four contexts were
reproduced afterwards, from a detached worktree at `aea47d9`, seat 5:

| Context | Result |
|---|---|
| `verify (node-24)` | `pnpm verify` **exit 0**; every `check:all` leg OK |
| (forced test leg) | `turbo run test --force`: **`0 cached, 14 total`**, 1891 tests, 0 failures, Testcontainers Postgres genuinely booted |
| `api-e2e` | **exit 0**, 5 files / 18 tests passed |
| `portal-e2e` | **exit 0**, **176 passed / 30 skipped / 0 failed**, 10.2 min |
| `full-stack-e2e` | **not reproducible** (see the gap above) |

The 30 skips are the `gate-screenshots*` capture specs, the same set CI skips. The
10.2 minutes corroborates #299: the "~1-2 min" figure in `ci.yml` and
`CONTRIBUTING.md` is off by roughly 6x.

**Partial substitute evidence for the missing context.** Everything the full-stack
job uniquely covers *below the browser* was exercised by hand and worked: three
images built, the migration ran as its own step ahead of the API, all four
containers came healthy, the API bootstrapped the first admin over the new 056 path,
and a hand-driven sign-in POST returned `303 -> /two-factor/enroll` with both
cookies correct. Only the browser-driven authoring-to-respondent journey is
unverified, and its blocker is a dev-container addressing limit rather than
application behaviour. **That is inference, not evidence**, and it is the one open
gap in `main`'s verification.

## Known environment hazards found during that run

- **An orphaned full-stack stack is holding seat 9.** Four `qcms-full-stack-e2e-*`
  containers have been running since 2026-08-04T20:56Z, holding `0.0.0.0:17900` and
  `0.0.0.0:17940` plus a named volume. Compose labels place its origin at a Windows
  host checkout and its project name predates the current per-seat naming, so it is
  from an older revision of `scripts/compose-e2e.mjs`. **Seat 9 is unusable for
  `verify:browser` and `up:e2e` until it is removed.** Removal is destructive and the
  stack is not this seat's, so it needs a Code Owner call.
- `CONTRIBUTING.md:144` and `:152` still present `pnpm up:e2e` as a local gate a task
  can run at a seat. It is CI-only from the dev container, which is the canonical
  environment (ADR-29). #316 already asks for the wording fix.
