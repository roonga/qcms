# QCMS port allocation

**Status:** authoritative. This is the **only** place the allocation table is written down. Every other document points here; none restates it. (The repo has been bitten by duplicated tables before: the ordering-exception table once had five divergent copies.)

**Binding as R8** (`PROJECT_INSTRUCTIONS.md`), decided in **ADR-37** (`docs/PROJECT_GOAL.md` §6), enforced by **`pnpm check:ports`** (`scripts/check-ports.mjs`, part of `check:all`, so `pnpm verify` and CI both run it). Motivated by **issue #255**.

## The rule

**QCMS uses two port blocks and nothing else. Never invent a port.**

Which block something belongs in is decided by **lifetime and audience**, not by what it is:

| | Block | Means |
|---|---|---|
| **4 digits** | `7Sxx` | A **stable, long-running, human-facing** service. A person may open it in a browser. Exclusive per seat, per machine. |
| **5 digits** | `17Sxx` | An **ephemeral test harness**. Nothing outside the suite should ever point at it. Owned by a seat, torn down with the run. |

`S` is the **seat**: a single index, `QCMS_PORT_SEAT`, selecting both blocks together. Default **0**.

That split is the judgement to apply to anything new. A long-running preview a human opens is 7xxx-shaped and takes a seat's stable block. A throwaway harness is 17xxx and takes a seat's harness block. Neither one gets a number picked because it looked free.

## The table

Seat `S`, where `S` is `0`-`9`:

| Port | Service | Block | Notes |
|---|---|---|---|
| `7S00` | portal dev server | stable | `pnpm dev:portal`. Published out of the dev container. |
| `7S10` | API dev server | stable | `pnpm dev:portal` starts it. Published out of the dev container. |
| `7S20` | dev Postgres | stable | `docker-compose.dev.yml`, **host-owned**. Deliberately *not* in the container's `appPort`. |
| `7S30` | artifacts server | stable | `pnpm artifacts`. Published out of the dev container. |
| `7S40` | admin dev server | stable | **Allocated, not yet published**: there is no `pnpm dev:admin`, and `appPort` is unchanged by this allocation. Start it with `pnpm --filter qcms-admin dev --port 7040`. |
| `17S00` | portal dev server (harness) | harness | Playwright `webServer`. |
| `17S10` | composed API (harness) | harness | Bound by the Playwright runner in `globalSetup`. |
| `17S20` | *(unused, deliberately)* | harness | Mirrors `7S20`. A harness run boots a Testcontainers Postgres on a kernel-assigned port and never wants a fixed one. The slot stays empty so `17S{nn}` maps onto `7S{nn}` without a second table. |
| `17S30` | in-test OTLP receiver | harness | Bound by the Playwright runner. |
| `17S40` | admin dev server (harness) | harness | Playwright `webServer`. |

Concretely:

```
seat 0 (default, and CI)   7000 7010 7020 7030 7040   |   17000 17010 17030 17040
seat 1                     7100 7110 7120 7130 7140   |   17100 17110 17130 17140
seat 2                     7200 7210 7220 7230 7240   |   17200 17210 17230 17240
...
seat 9                     7900 7910 7920 7930 7940   |   17900 17910 17930 17940
```

**Seat 0 is exactly today's allocation.** An existing developer and CI set nothing and see 7000 / 7010 / 7020 / 7030 unchanged. That is a compatibility contract, asserted in `apps/portal/e2e/support/port-seat.test.ts`, not just an intention.

## Where it lives in code

`scripts/ports.mjs` is the only place the arithmetic is written:

```js
import { stablePort, harnessPort, composeProjectName } from "./scripts/ports.mjs";
stablePort("portal");        // 7000 at seat 0, 7100 at seat 1
harnessPort("otlp", 2);      // 17230
```

- Root dev scripts (`dev-portal.mjs`, `serve-artifacts.mjs`) import it directly.
- The Playwright harness reaches it through `apps/portal/e2e/support/port-seat.ts`, which adds the startup refusals below.
- `apps/*/e2e/support/harness-config.ts` derive every harness port from it; there are no port literals left in either.

## The `QCMS_PORT_SEAT` contract

- **Unset or empty** means seat `0`.
- **Otherwise it must be a single digit `0`-`9`.** Anything else throws immediately, naming the variable, the offending value and this document. It is never coerced and never silently falls back to 0: falling back to 0 is precisely how a run lands on another seat's ports without anyone noticing, which is the defect this whole scheme exists to remove.
- It is listed in `turbo.json`'s `globalPassThroughEnv`. turbo 2.x runs tasks in strict env mode, so without that entry the variable would reach `pnpm test` and never reach Vitest, leaving a seat on 0 inside the test run and on its real seat everywhere else.
- The Playwright suite prints its seat and its four ports on every run, so a run's own output says which seat produced it.

## Why these numbers

Worth recording, because each of these was got wrong at least once on the way here.

**Why `7xxx` for human-facing.** It is what the repo already used, it is memorable, and it is far from anything a developer's other tooling claims. Keeping it four digits is what makes the two blocks distinguishable at a glance.

**Why not `7xxxx` for the harness.** "Five digits, keep the 7" reads as `70000` and up. The maximum TCP port is **65535**, so that block is not merely unwise, it cannot bind at all. `17xxx` keeps the mnemonic (a `7` in the same place) and stays legal.

**Why a fixed port must stay out of the OS ephemeral range.** The kernel hands out auto-assigned source ports from `net.ipv4.ip_local_port_range` (32768-60999 on a stock Linux, and on the machine this was developed on). A *fixed* listener inside that window binds successfully almost every time and then, rarely, loses the race to a socket the kernel already assigned. That is the worst possible failure class: unreproducible, and indistinguishable from a real startup failure. `17xxx` is comfortably below it. The safe fixed windows are `10000-32767` and `61000-65535`.

The range is **read at runtime**, not hard-coded: it is tunable, and CI runners differ, so one machine's measurement is not a fact about the next one. `assertSeatPortsOutsideEphemeralRange` fails at startup, naming the ports and the range, on a machine that moved the window under the block.

**Why the OTLP receiver is not on 4318.** 4318 is the OTLP/HTTP default. A developer running the documented local trace viewer (`docs/DEVELOPER_GUIDE.md`) holds it, and the suite must neither silently export into that viewer nor fail to bind because it is taken. The old harness picked 4319 to sidestep this by hand; the seat scheme satisfies the same intent by construction, since the whole allocation is elsewhere.

**Why 7S20 is host-owned and out of `appPort`.** The dev Postgres runs on the **host** via `docker-compose.dev.yml`, which publishes the port itself. If the dev container also claimed it in `appPort`, whichever started second would fail to bind: `docker compose up` with "port is already allocated", or container creation outright. The container reaches the database over the host gateway instead. It stays in `forwardPorts` only for the editor label, which is a no-op on the CLI route.

**Why one seat index and not two knobs.** Two indices (one per block) would need to be kept in step by hand, and the failure of forgetting is silent. One number is one thing to say and one thing to check.

**Why nine is the ceiling, deliberately.** A single digit is what keeps `7Sxx` four digits and `17Sxx` five. Ten concurrent dev stacks or browser suites already exceed what one workstation can honestly run: the browser suite alone drives a Testcontainers Postgres, a composed API and two Next dev servers. The limit is a design statement, not an oversight to be widened later.

## Startup refusals

Three, all at Playwright config load, which is before any `webServer` entry is evaluated and therefore before `reuseExistingServer` can adopt anything.

1. **A worktree must name its seat.** If `QCMS_PORT_SEAT` is unset and the repo root is a **linked git worktree** (its `.git` is a file, not a directory), the run refuses. See "the residual risk" below for why this specific tell. The primary checkout and CI keep the silent default.
2. **Ephemeral-range check** (above).
3. **Occupancy check.** If anything is already listening on this seat's harness ports, the run refuses and names the occupant's pid and `/proc/<pid>/cwd`. The one exception is a **portal or admin dev server whose cwd is this exact worktree**. The composed API and the OTLP receiver are never adopted, whoever owns them: the runner binds both itself, once per run, so a live listener there is a leak or a concurrent run.

An occupant whose owner **cannot be determined** is refused, not adopted. "Cannot tell whose it is" and "it is mine" must never collapse into the same outcome; that collapse is exactly how a false green is produced.

Reading `/proc/<pid>/cwd` is not incidental: it is how the original collision was caught by hand (issue #255). The refusal automates that read so the next person gets the answer in the error message.

### The occupancy check is a diagnostic, not the safety property

**Say this plainly, because it is easy to mistake:** probing before binding cannot make concurrent binding safe. Between the probe and the bind there is a window, and another run can take the port inside it. A sibling lane demonstrated exactly that on 2026-08-02: it checked ownership, found the ports free, started, and lost the race to a *third* lane that claimed them in the intervening seconds. It cost a wasted suite run and about fifteen minutes.

What that lane got in the end was an `EADDRINUSE`, and that was **luck**. Had `reuseExistingServer` won the race instead, it would have run its specs against the other lane's tree and reported green.

So the occupancy check earns its place as a fast, clear error for the common case (someone forgot to set a seat) and as a way to name the occupant instead of making the next person read `/proc` by hand. It is not the mechanism. **Per-seat isolation is the mechanism**: its job is to make sharing not happen, rather than to detect sharing after the fact. Two runs that share a seat number are still broken, and no amount of probing changes that.

### `reuseExistingServer` is the amplifier

Without it, a port collision is a noisy `EADDRINUSE`. With it, a port collision is a silent green run against somebody else's tree. That asymmetry is the entire reason issue #255 is a gate-integrity item rather than an inconvenience, and it is why the flag deserves its own treatment rather than being left at `!CI`.

It **does not** stay `!CI`. It is now computed per server, and is true only when a portal or admin dev server is **already listening and its `/proc/<pid>/cwd` is this exact worktree**: the case it was actually there for, where reuse tests the tree you are in. In every other state, including the ordinary one where the port is free at config load, it is **false**. So a run that loses the bind race to a process arriving a second later fails loudly instead of adopting the winner. That is the direction a race has to fail in, and it is the part the probe on its own cannot give you.

CI is unaffected: it never reuses, as before.

### The residual risk is a seat collision, not a port collision

Once seats exist, the only remaining way this fails is **two runs picking the same seat**. What happens then is exactly what happened before seats: they contend for the same four ports, and the first startup refusal that notices wins. With `reuseExistingServer` now off for a free port, that contention surfaces as a refusal or an `EADDRINUSE`, not as a false green. It is still a broken run, and still a wasted one.

The default cannot simply be removed: seat 0 has to stay byte-identical for an existing developer and for CI, which is the compatibility contract that makes this change safe to land in one step. But the population that actually collides is neither of those. It is concurrent agent lanes, and by this repo's own rules every one of them runs in a `git worktree`.

So the default is **loud exactly where it is dangerous**: a linked worktree with no `QCMS_PORT_SEAT` set is refused at startup, naming the variable, before anything binds. A linked worktree is detectable at zero cost because its `.git` is a file (`gitdir: ...`) where a primary checkout has a directory. `QCMS_PORT_SEAT=0` remains a perfectly good answer when nothing else is running: what is refused is silence, not the value.

An orchestrator running N lanes should hand each lane its seat number explicitly, the same way it hands out worktrees. That is the claim step, and it is deliberately manual rather than discovered: an automatic "find a free seat" would reintroduce the ambiguity this replaces, where nothing in a run's output says which seat it actually got.

## What went wrong (issue #255), so the shape is not re-derived

The harness ports were compile-time constants: portal 3100, admin 3200, composed API 4010, OTLP receiver 4319. None was overridable. The root Playwright config sets `reuseExistingServer: !CI`.

So when a second agent lane started a browser run while a first lane's dev servers were still up, Playwright did not fail to bind and did not warn. It **reused** the first lane's servers, and the second lane's specs exercised the first lane's worktree. The second lane saw a full green run with nothing in the output to say otherwise, and the merge gate treats a green `verify:browser` as evidence. A false green there is indistinguishable from a real one.

The root cause was not carelessness: there was no mechanism by which two lanes *could* avoid each other, so "do not collide" could only ever be a discipline. The best a careful lane could do was edit the four tracked constants to private values, verify ownership through `/proc/<pid>/cwd`, run, and remember to revert. Two lanes did versions of that dance on 2026-08-02 and were burned in two different ways. The seat is the mechanism that removes it, and the gate is what stops the rule decaying back into folklore.

## Multiple developers and multiple concurrent seats

**Status: partly proven, mostly design intent.** Marked per item below. Two concurrent *harness* seats have been exercised end to end. The two-human-seat story has not been run, because it needs a dev-container rebuild.

### What is exclusive, and at what scope

- **The stable block is exclusive per machine, per seat.** Seat 0's 7000 / 7010 / 7020 / 7030 are host binds. Two checkouts, two developers, or two dev containers on one host cannot all run seat 0's stable stack: the second one fails to bind.
- **The dev container name is exclusive too, and collides first.** `.devcontainer/devcontainer.json` pins `--name=qcms-dev-container`. Two seats would clash on that name before they ever clashed on a port. A seat-suffixed name is the obvious shape; see the devcontainer note below.
- **The harness block is exclusive per seat but cheap to move.** It is bound by whichever host runs the tests, for the duration of the run.
- **The Compose project name matters as much as the port, and the failure is worse than sharing.** Two Compose stacks with the same project name **are the same stack**. A second seat that moved only `QCMS_DB_PORT` would hand Compose the same project with a changed port mapping, so `docker compose up -d` **recreates** the running container on the new port against the same volume: seat 1 does not quietly join seat 0's database, it **takes it away mid-session**, leaving seat 0's processes dialling a port nothing serves. Nothing errors on either side. That is what makes the project name necessary rather than tidy. `composeProjectName()` returns `qcms-dev` at seat 0 and `qcms-dev-s<N>` otherwise; `scripts/dev-portal.mjs` exports it as `COMPOSE_PROJECT_NAME`, which outranks the `name:` in the compose file. Named volumes are namespaced by project, so a distinct name gives a seat its own data as well as its own container. *(Proven for seat 0 by the existing dev path; the seat-N branch is unit-tested, not yet run.)*

### How a seat claims its number

**Explicit `QCMS_PORT_SEAT` is the contract**, and a linked worktree with no seat set is refused at startup rather than defaulted. The reasoning, and why probing is not a substitute, is in "the residual risk" above.

Practically: seat 0 for the single developer and for CI; seats 1-9 for concurrent agent lanes, assigned by whatever is orchestrating them.

### Container versus host: which layer actually collides

This is the part that is easy to get wrong, so state it precisely:

- **Inside a container, ports do not collide across containers.** Each has its own network namespace, so two dev containers can both have a process on 7000 internally with no conflict at all.
- **Publishing collides on the host.** `appPort` (and `docker run -p`) bind on the Docker host. Two containers publishing 7000 cannot both start.
- **The harness block is never published**, and that is why `appPort` and `forwardPorts` need **no change** for this allocation. Harness ports are bound by whichever host runs the tests and are reached only from that same host: the Playwright runner, the Next dev servers and the composed API are all in one place. Nothing outside needs to reach them. *(Verified by inspection of `playwright.config.ts` and both server wrappers: every harness URL is `localhost`/`127.0.0.1`.)*
- **The Testcontainers Postgres is a sibling on the host** with a kernel-assigned port, so it never enters this allocation at all.

### The devcontainer, honestly

`appPort` is **static JSON**; it cannot read a runtime value the way a script can. The devcontainer specification does define `${localEnv:VAR}` substitution, and it is used for `runArgs`, `mounts` and `containerEnv` in practice, but **whether it applies to `appPort` has not been verified here** and could not be: testing it requires rebuilding the container, and a live session was running inside it. Treat it as unverified.

The honest alternatives for a second human seat, in preference order:

1. Run the second seat **outside** a dev container (a plain host checkout), which needs nothing but `QCMS_PORT_SEAT`.
2. Launch the second container by hand with explicit publishes (`docker run -p 7100:7100 -p 7110:7110 -p 7130:7130 ... --name qcms-dev-container-s1`).
3. Edit `appPort`, `forwardPorts`, `portsAttributes` and `--name` for that machine and rebuild. A local edit, not something to commit.

**No devcontainer change is needed for this allocation, and none was made.** Seat 0 publishes exactly what it published before.

### Remote and Codespaces

Each Codespace is its own machine, so seats do not interact across them: a Codespace can stay on seat 0. `forwardPorts` drives the editor's tunnel there rather than a host bind, so the host-collision reasoning above does not apply. Nothing further is claimed; this has not been exercised.

## Runbook

### Day one, one developer

Do nothing. You are seat 0, on the ports every document already names.

### Running a second concurrent lane

```bash
QCMS_PORT_SEAT=1 pnpm verify:browser        # harness on 17100/17110/17130/17140
QCMS_PORT_SEAT=1 pnpm dev:portal            # stable stack on 7100/7110/7120, project qcms-dev-s1
```

Export it once per shell if a lane runs several commands. Every consumer reads the same variable.

### A port refuses to bind

1. Read the error. The Playwright refusal already names the port, the pid and the occupying process's working directory.
2. If the occupant is another seat's run, pick a free seat: `QCMS_PORT_SEAT=<n>`.
3. If you cannot tell what holds it: `ss -ltnp 'sport = :7000'`, or `readlink /proc/<pid>/cwd` on the listening process. That read is what caught issue #255 in the first place.
4. If the dev container will not create because 7000 or 7010 is taken, it is a host process or another qcms dev container: `pnpm devcontainer status`, then stop the other one. See `docs/DEV_CONTAINER.md`.

**Do not reach for a random free port.** That is how 3300/3301 happened (see below).

### An ad-hoc preview or spike

Take a seat, do not invent a number.

A worked example, from the night this allocation was written: a preview stack for the Code Owner was put on **3300 / 3301**, with its database on 7020 and a second artifacts server on 7031. Every one of those is outside the allocation, and 7031 in particular is inside the stable block but not on any grid line, which makes it invisible to anyone reading the table. Under this rule that stack is long-running and human-facing, so it is `7Sxx` shaped: it takes a free seat and runs on `7S00`/`7S10`/`7S20`/`7S30`. Nothing about it needed a new number.

## What the gate can and cannot see

`pnpm check:ports` matches a number only where the surrounding syntax says "this is a port": a URL authority, a `--port` flag, a `docker run -p` host side, an assignment or property named `port`/`*_PORT`/`*Port`, a devcontainer `appPort`/`forwardPorts` array, a `${VAR:-NNNN}` default, and the prose form `port NNNN`. It deliberately does **not** scan for bare four-digit numbers: years, byte caps, timeouts and pixel sizes are everywhere, and a gate that fired on those would be switched off within a week.

The other half of that has to be written down too, because an unwritten limit is how a gate gets trusted beyond its reach - exactly how the #74 GHCR mirror stayed bypassed inside `verify` for weeks. These three evasions were **measured** against a clean tree and all three passed:

| Evasion | Why it slips through |
|---|---|
| `const PORT = 9998;` | a standalone all-caps `PORT` is not in the identifier alternation (which covers `port`, `Port`, `_PORT`, `xPort`) |
| a `--port NNNN` flag in `package.json` | a shape the scanner *does* recognise, in a file it does not read. Broad `.json` is excluded on purpose: the append-only golden corpus (ADR-18) must never be something a gate can demand an edit to. A coverage gap, not a pattern gap |
| `- "9988:5432"` in a Compose file | only the `${VAR:-NNNN}` default form is scanned, not a bare publish mapping - the form `docker-compose.dev.yml` uses for its own port |

A port built by arithmetic or assembled in a template literal is inherently out of reach. That is not a defect to fix; it is why **R8 is a rule about derivation, not a rule about literals**. Deriving from `scripts/ports.mjs` is the only thing that makes those cases safe.

So: **a clean run means "no port is written in one of the recognised shapes", never "no port outside the allocation exists".**

Two more things the numbers can mislead about:

- **The `ALLOWED` list is not a map of what the gate reads.** It was written defensively while migrating and accumulated 8 entries the scan could never reach, so it overstated the gate's reach: an entry existing is not evidence the gate sees that file. Those 8 are gone, and `check-ports.test.ts` now fails on any exemption that stops firing, so the list stays exactly the set of findings the gate really suppresses. It still says nothing about the files or numbers no pattern matches in the first place, which is the whole point of the table above.
- **The startup occupancy check depends on `/proc`.** `occupantOfPort` returns `undefined` when `/proc/net/tcp` is unreadable, so on a platform without it (macOS, or a restricted container) the refusal is **silently inert** and a run proceeds as though the ports were free. It degrades safely rather than dangerously - per-seat isolation is untouched, and `reuseExistingServer` stays off for a port that looks free - but the refusal is not the absolute backstop the section above might read as. It is a Linux convenience on top of the seat, not a substitute for one.

## What this does not cover

- **Adopter-facing defaults.** The API's shipped default listen port (3000) is a product default for people deploying QCMS, not an allocation on a QCMS developer's machine (ADR-20: the API container is never published). Every QCMS dev path passes `7S10` explicitly. Likewise `5432` where it names Postgres's own well-known port inside a container.
- **Third-party tools you run yourself.** The optional local trace viewer in `docs/DEVELOPER_GUIDE.md` uses Jaeger's and Aspire's own ports. Those are their allocation, not ours.
- **Kernel-assigned ports.** Testcontainers, and any test that binds port `0`, are outside this entirely and should stay that way.

Each exemption is pinned to a specific file, with its reason, in `scripts/check-ports.mjs`'s `ALLOWED` list. Adding one is a deliberate act with a written reason, which is the point.
