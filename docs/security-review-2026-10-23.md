# QCMS pre-launch security review, 2026-10-23

**Status:** evidence, not a sign-off. The 040 security review is a **Code Owner
gate**; this document is the material that gate reads. Nothing here declares the
review passed.
**Executed by:** task 040 (`docs/features/040-security-review-hardening.md`),
which runs the assurance plan in `docs/SECURITY_DESIGN.md` section 10 (SEC-12).
**Tree reviewed:** `origin/main` at `92262a80` (`feat(admin): 1116 one rail frame and anatomy for the form, question and Settings rails (#1127)`).

**On the base, which moved repeatedly during the pass, and what was done about
it.** The pass was performed at `7fe67b6e` (#1100), and the commits in the table
below each merged while it was being written. None is a rebase this document can
wave through: each reaches something it asserts on, and **each
falsified a statement that was true when written**. So each was read rather than
assumed, and each stale paragraph was rewritten rather than left standing. #1101
and #1102 also joined the cited review set, because each proved a control by
probe; the other six did not, because none proves a control.

**A base that moves this often is itself a finding about this document's form,
and it is recorded rather than smoothed over.** A dated review of a repository
merging several times a day is a snapshot whose shelf life is hours for its
measured claims and weeks for its reasoned ones. The reasoning in sections 3, 4
and 7 has survived every move untouched. What moved each time was bookkeeping: a
count, a line number, a digest, a scanner figure. That asymmetry is the practical
guidance for whoever reads this at sign-off: **trust the reasoning, re-run the
numbers**, and section 1's three-part test below is how.

| Commit                                            | What it changed in this document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `73c37f51` (**#1101**)                            | SEC-8 and SEC-10. It wraps three catalogue reads in `packages/db/src/environment/regrant.ts` and widens `packages/db/privileges/privilege-map.sql`. **Section 4.3** said four sentences overstated the credential-free statement path; #1101 closed that, and what stands there now is the narrower residue #1101's own reviewer found                                                                                                                                                                                                                                                                                                                                        |
| `cd040e48` (**#1102**)                            | SEC-6 and SEC-15, through 070's follow-ups. **Section 4.4** recorded two open residues from #1100's review, a docblock naming the wrong refusal mechanism and an untested confirm branch; #1102 closed both, and section 4.4 now records them as closed with what closed them                                                                                                                                                                                                                                                                                                                                                                                                 |
| `5de4ef99` (**#1077**)                            | No control. What it falsified was a claim **this document made about itself**: that #1077 reached none of the files cited here. It reaches three. Each diff was read and no cited claim is touched, which is the paragraph below                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `5379319b` (**#1107**)                            | No control, and the first base move that **did** reach live claims. Its one file is `pnpm-lock.yaml`, which retires #1054 and changes what `pnpm audit` reports. **Section 6's dependency figures and section 5.1's whole #1054 argument were re-measured on this base rather than carried forward**, and a new high arrived with the refresh (#1112)                                                                                                                                                                                                                                                                                                                         |
| `4c898409` (**#1108**)                            | No control. It reaches four cited paths: `.github/workflows/images.yml`, `scripts/image-scan.mjs`, `docs/operations.md` and `docs/SECURITY_DESIGN.md`, plus the three Dockerfiles section 6 asserts on. Each was re-read and every cited claim holds: six `FROM` lines still carry a digest beside the tag, the scanner's distro guard is intact, the blocking and reporting floors are unchanged, and the outbound-network heading is untouched in content. **One line number moved and is corrected below.** It also ticks the second of criterion 3's four items                                                                                                           |
| `541530e5` (**#1114**)                            | No control. One file, `pnpm-lock.yaml`, and it **retires #1112 and makes `pnpm audit` clean**. So section 6's dependency figure and section 5.1's #1112 argument were re-measured here too, and the fix turned out to be the upstream half of the choice section 5.1 left open: `chromium-bidi` moved from `17.0.2` to `157.0.8090-0`, declaring `zod: ^4.6.5`, so `zod` is now a single resolution at 4.6.7 and **no override was added**                                                                                                                                                                                                                                    |
| `5840cecc` (**#1113**) and `dbe751ce` (**#1120**) | No control. **Part 1 of the test flagged one cited file; parts 2 and 3 were empty.** That is the test working rather than passing: between them the two commits touch `.rtk/filters.toml`, `CLAUDE.md`, `docs/RETRO.md`, `plan/admin-design-contracts.md` and `plan/left-rail-proposal.md`, and **`CLAUDE.md` is cited here** for the npm scope. Reading that diff is what settles it: #1113 appends a writing-style section and an `rtk-instructions` block and **leaves the `@roonga` scope line untouched** (`CLAUDE.md:29`), which is the only line this document relies on. The cited claim survives **because the diff was read, not because the test came back empty** |
| `c3b21a49` (**#1109**)                            | No control. **Part 1 flagged three cited paths and part 2 flagged `docs/SECURITY_DESIGN.md`**, and it is the only base move so far to conflict with this branch, on the ledger table. Reading the diff settles it: #1109's edits to that file are confined to **section 4's key-inventory row** and **section 8d**, touching no SEC-12 row and no part of section 10, so **no cited claim is falsified**. It did make one stale, which is now fixed: the SEC-17 row cited phases C and D of `plan/agent-everywhere.md`, and #1109 numbered those as work orders **082** and **083** and put them on the launch gate                                                           |
| `92262a80` (**#1127**)                            | No control. **All three parts of the test empty.** It is an `apps/admin` rail change with its template mirror, and it touches no cited path, no ADR or SEC record, and none of the measurement inputs: no lockfile, no `docker/`, nothing under `.github/` and nothing under `apps/api`                                                                                                                                                                                                                                                                                                                                                                                       |

Every other statement here was re-confirmed at the tree reviewed. **The pattern is
worth naming for whoever reads this next**: a dated review of a tree that moves
hourly is only as good as its willingness to be re-read, and repeatedly within one pass a
paragraph that was accurate when written had stopped being true within hours. The cheap defence is the one used here, which is to re-read rather than to
rebase quietly.

**#1077 overlaps three cited files, and the overlap reaches nothing.** An earlier
draft of this section said #1077's changed-file list intersected none of the
files cited here. **That was wrong twice over**, and both errors are worth
recording because they are errors in the test this document tells its reader to
run. The draft ran the test against a hand-written list of paths, which omitted
two of the three; and a mechanical re-run over every backticked path in this
document still missed the third, because ADR records are cited here **by number**
rather than by path. The honest result, from
`git diff --name-only cd040e48 5de4ef99` (134 files) against both the cited paths
and the files holding the cited ADRs:

| Overlapping file     | Where this document cites it                                                                                              | What #1077 changes in it                                                                                                                                                                                                                                                                                                                                                         | Reaches a cited claim? |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `docs/operations.md` | Section 4.6, the per-environment firewall half                                                                            | Two rows added to the portal and admin environment tables, both `QCMS_LOCALE`. `### Outbound network the API needs`, which is the line section 4.6 points at, is untouched in content. **Its line number has since moved**, from `:177` when #1077 landed to `:191` at the tree reviewed, because #1108 added rows above it. The heading is the stable handle; the number is not | **No**                 |
| `docker-compose.yml` | Section 4.3, "the shape `docker-compose.yml` gives `qcms_migrate`"                                                        | Two `QCMS_LOCALE: ${QCMS_LOCALE:-}` lines on the `portal` and `admin` services, with comments. No line touching `db-roles`, `qcms_migrate`, `CREATEROLE` or `LOGIN`                                                                                                                                                                                                              | **No**                 |
| `docs/adr/core.md`   | Not by path, by number. Of the seven ADRs this document cites, **five live here**: ADR-20, ADR-27, ADR-40, ADR-41, ADR-42 | One amendment and one Note appended inside **ADR-27** (`docs/adr/core.md:607`). ADR-20 (`:551`), ADR-40 (`:265`), ADR-41 (`:424`) and ADR-42 (`:129`) are all outside that hunk. ADR-27 is named by this document only in this header block, and only to record what #1077 changed to it                                                                                         | **No**                 |

**The by-number half of the inventory, built mechanically rather than from
memory, because a hand-written version of it is what went wrong twice.** Every
`ADR-<n>` in this document, mapped to the file whose `### ADR-<n>` heading
defines it:

| ADR cited here | Defined in                   |
| -------------- | ---------------------------- |
| ADR-20         | `docs/adr/core.md:551`       |
| ADR-25         | **`docs/adr/admin.md:15`**   |
| ADR-27         | `docs/adr/core.md:607`       |
| ADR-40         | `docs/adr/core.md:265`       |
| ADR-41         | `docs/adr/core.md:424`       |
| ADR-42         | `docs/adr/core.md:129`       |
| ADR-43         | **`docs/adr/portal.md:104`** |

A draft of this table carried a "times cited here" column. It is dropped, and
the reason is worth a sentence because it is the same trap as the two errors
above: **a count of `ADR-<n>` mentions inside the document that reports the count
cannot be stated without falsifying itself**, and writing this table moved every
figure in it. The mapping is what the test needs; how often each record is named
is not.

So the ADR surface is **three files, not one**: `core.md`, `admin.md` and
`portal.md`. **Only `core.md` is in #1077's diff**, and neither `admin.md` nor
`portal.md` is, which is why ADR-25 and ADR-43 do not appear in the overlap table
above. An earlier version of that row said ADR-25 lived in `core.md`, which is
wrong, and omitted ADR-43 entirely, which sections 4.5 and 5 both lean on. Both
errors were in the cell whose stated job is to catch exactly what a path scan
misses, so they are recorded rather than quietly fixed.

So the conclusion the draft reached is right and the test it reported was not.
Every claim here survives #1077 unchanged, and that is now a read of three diffs
against a derived inventory rather than an assertion about a file list.

**#1107 is the one base move that reached live claims, and it shows the test's
third blind spot.** Its only file is `pnpm-lock.yaml`. A path scan would catch
that, but **this document never cites the lockfile by path**: section 5.1 and
section 5.2 refer to "the lockfile" and to resolved versions in prose. So the
overlap was real and the by-path half would have reported it while the by-number
half said nothing, and what actually caught the staleness was re-running the
measurement. Both affected places were re-measured on this base rather than
carried forward: **section 6's `pnpm audit` figures** and **the whole of section
5.1's #1054 argument**, which #1107 retired. A new high arrived with the refresh
and is now #1112.

**The general rule this sets, because `main` will move again before this is
read.** A commit after `92262a80` invalidates nothing in this document unless it
reaches something the document cites. Run the test in **three** parts, because
each of the first two alone has already missed something, and because a line
number inside a file nobody changed can still move:

```sh
# 1. the paths cited here, which are deliberately file-and-line
git diff --name-only 92262a80 origin/main
# 2. the records cited by number, which no path scan catches. `docs/adr/` is
#    three files here, not one: core.md, admin.md and portal.md
git diff --name-only 92262a80 origin/main -- docs/adr/ docs/SECURITY_DESIGN.md

# 3. the measurements, which no diff catches, because this document quotes
#    numbers rather than paths for them: `pnpm audit`, the image scan's counts
#    and the open-issue sweep. Re-run them; a lockfile or digest move changes
#    what they say without touching a path cited here.
pnpm audit
```

**And a fourth step, for whoever edits this document rather than reads it.** It
is not part of the staleness test, it is the thing that would have prevented five
of the twelve corrections below, and it comes from the reviewer who kept finding
them. **After every rebase, grep this document for the previous base SHA and for
every landed-count phrase**, because those are exactly the statements a rebase
moves and the only ones a diff of the branch will not show you:

```sh
# the base you just left, and every one before it
git grep -n '<previous base sha>' -- docs/security-review-2026-10-23.md
# and the counting words, which go stale when a referenced change merges
grep -niE 'two merged|one open|remaining|of the four|base moves' \
  docs/security-review-2026-10-23.md
```

An overlap is not yet a staleness: read the diff of each overlapping file and ask
whether it reaches the lines cited, the way the table above does. If nothing
does, this document stands as written. If something does, the affected section
needs re-reading the way sections 4.3 and 4.4 were.

**It supersedes `docs/security-review-2026-08-14.md` by date**, which is the
mechanism that document and 038's pre-flight both name. The August document
stays as written: its table column is headed "State at close of review" and it
records what was true on its own date. Nothing in it is edited by this pass.

**Why a new dated document rather than an addendum.** **Two artifacts name the
mechanism**, and a third supplies the reason it is the right one.
`docs/features/038-launch-gate-validation.md`'s pre-flight already says "a later
pass supersedes it by date", so a date is the handle 038 reaches for; and the
August document's own header says "**Supersedes nothing.** The next review
supersedes this one by date", so it anticipates a successor rather than an
appendix.

**`plan/admin-ux-audit.md` names something different and is cited for that.** It
does not mention supersession by date. What it records is the **frozen-snapshot
convention** that makes supersession necessary: it contrasts itself, "maintained,
not frozen", with `docs/security-review-2026-08-14.md`, which "stays frozen"
because "a review snapshot records what was true on a date". That is the premise,
not the mechanism. Taken together, an addendum would have had to restate the
August verdicts to correct them, which is the one thing a frozen snapshot must
not do.

---

## 1. What was reviewed, and how

**Why this pass exists.** The August pass was performed at `f30dbc5`. Since then
the product gained the whole environments and workspaces track (tasks 064 to
070, ADR-40, ADR-41, SEC-14, SEC-15, rulings Q40 to Q83), the repetition wave
(071 to 077, ADR-42, ADR-43, SEC-16), the agent decision (ADR-25 as amended,
SEC-17), the Next 16.4 move, and the `#1094` restore re-grant with its own
follow-ups (#1101, rulings Q82 and Q83). Five of those add or change a security
control. A document dated August cannot be the evidence for
a gate on a product that has changed this much, which is what criterion 5's "by
date" is for.

**Scope.** The API surface (`apps/api`), the two BFF apps' security-relevant
seams, `packages/db`'s role, grant and query surface, the shipped Compose and
Docker artefacts, the committed example environment files, the dependency tree,
and the repository's own GitHub configuration.

**Method, and the one thing it deliberately does not do.** This is a **delta
review that cites probe-backed evidence rather than re-deriving it**. Every
post-August control named here was verified by an independent reviewer at an
exact merged head, by probe or by mutation, and the verdict is recorded in an
`AGENT-REVIEW: APPROVE` comment on the pull request that landed it. Re-running
those probes here would produce a weaker claim than the one already on the
record, because the reviewer who made it had the branch, the mutation and a real
Postgres in front of them. So each row below does two things instead:

1. **cites the review that proved it**, by pull request and approved head; and
2. **states what was checked at the tree reviewed** to confirm the control is still
   there, which is a file-level re-read rather than a re-probe.

Where nothing proved a claim, this document says so rather than inferring it
from a green suite.

**The ten reviews cited.** Each is the final `AGENT-REVIEW: APPROVE` on its
pull request, at the head that merged, read on 2026-10-23.

| PR    | Task                                                              | Approved head | What its probes established                                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1044 | 064 environments as schemas, the three role kinds                 | `47f45ae9`    | `public` on no search path and `CREATE` granted to nobody; grants asserted per role from the catalogue; the two planes' table-name sets disjoint; boot refused when config and `control.environments` disagree                 |
| #1053 | 065 release records and promotion                                 | `c0ccf196`    | release append-only by trigger, `UPDATE` and `DELETE` refused as `qcms_app_control`; per-environment roles hold `SELECT` only on `control.form_releases`, proved by a grant mutation that turned the least-privilege suite red |
| #1059 | 068 workspaces on the organisation table                          | `ca92cee6`    | archive refuses while a workspace owns any form or is the shared library; no code path deletes a workspace and none reaches a response row                                                                                     |
| #1060 | 066 environment-scoped links and the `/<env>/` prefix             | `f5fbe670`    | the drop rule proved both ways under a thirteen-statement mutation matrix; the release race refused by the composite key rather than duplicated, under a held-open transaction                                                 |
| #1061 | 069 membership, the two role families, the access audit           | `e6e71a54`    | the authorization middleware: 27 of 27 forged-environment request shapes refused across four routes with the production objects unchanged; the fail-closed refusal proved by deleting a policy row at runtime                  |
| #1093 | 067 per-environment delivery, retention, reporting                | `1e5d07d4`    | `security_barrier = true` reproduced against a real Postgres **with a negative control**; SCRAM verifier re-derived independently per RFC 5802 and the plaintext proved absent from the server log                             |
| #1099 | the `#1094` restore and the re-grant model                        | `8fa5a624`    | the re-grant is idempotent and emits no credential in any error path; three grant mutations each turn the restore gate red by name                                                                                             |
| #1100 | 070 the two-person rule for production                            | `773581a5`    | a `prod` endpoint change reaches no endpoint row until a different approver confirms it; the proposer refused on both the pre-apply and the applied branch                                                                     |
| #1101 | the re-grant's reads wrapped, and #1099's six findings closed     | `d8708c29`    | the three catalogue reads now refuse without a statement, proved non-vacuous by unwrapping one and watching exactly one case go red on `/Failed query/`; the privilege map widened to domains                                  |
| #1102 | 070's follow-ups: the real mechanisms named, two test gaps closed | `d6be9d2b`    | the applied-withdraw refusal traced to the one guard that answers it, with the statement predicate and the CHECK behind it; the proposer refused at an already-applied row, proved the only case on that branch by mutation    |

---

## 2. The input set: open issues at 2026-10-23

Listed at run time rather than taken from a prior triage, the same way the
August pass did it.

> **The totals in this section are a reading taken on 2026-10-23 and are not
> maintained. Re-measure before signing.** The repository opens and closes
> issues faster than a review pass takes to write, and this document tried
> quoting a current total four times and was stale four times. What it does
> maintain is the **named** set: which issues are security-relevant and what
> severity each carries, in section 5. Those move slowly and are the thing the
> criterion actually turns on.

**What arrived after the sweep is named rather than counted**, because a count
moving is uninteresting and what moved with it is not:

- **#1105 and #1106 are titled "Security: ..."** and so match the sweep by
  construction. They are the two out-of-scope issues section 9 asked the Code
  Owner to file, a post-launch penetration test and a bug bounty decision, so
  they are **commissioning items rather than findings against this tree**.
- **#1110 and #1111 are findings, both LOW**, and both are in section 5's table.
  Neither was found by this pass: #1111 came out of #1108's lane and
  **falsified a claim this document made**, that no override had a lapsed floor
  (section 5.2), and #1110 is an evidence-integrity defect of the same class as
  #989 and #1025.
- **#1104 is not security-relevant at all**: it is admin export refusal copy.
- **#1112** arrived later the same day and is **already retired**: it was the
  `pnpm audit` high the #1107 refresh surfaced, and #1114 closed it. Section 5's
  table carries it as retired, with its reasoning kept because that reasoning is
  the precedent for the next one.

- **81 open issues** and 4 open pull requests at the **2026-10-23** sweep, per
  the note above.
- **The `security` label carries exactly #977, #971 and #969**, which is a named
  set rather than a count and is the useful half. It carried #1054 too until
  #1107 closed it.
- **3 carry `blocker`**: #360, #362, #363.
- **The security-relevant set is section 5's table**, which names every member
  and its severity and is the authoritative list. This section does not restate
  it or count it. The sweep that built it is a keyword one over titles and bodies
  (security, SEC-, auth, grant, privilege, token, secret, credential, CVE,
  leak, redact, injection, XSS, CSRF, SSRF, origin, cookie, session, CSP, HSTS,
  provenance, attestation, SBOM, egress, allowlist, replay, tamper, publish).
  Severities are in section 5.

**There is no `qcms-f3` label.** That string appears only as a branch and
worktree name on closed pull requests. The Dependabot and CVE rounds asked about
resolve to #1047, #1049, #983, #1043 and #1046, **all closed**. Their open
residue is the standing scheduled-scan ticket #977, plus #971,
#969, #985, #986 and #982.

**Every finding the August review recorded is retired.** Cross-referencing its
finding table and its section 10 follow-up list against the open set: #470
(HIGH), #390 (HIGH), #432, #453, #401, #372, #471, #478, #482, #402, #444, #361,
#488 to #494 and #504 are **all closed**, and F1 (placeholder secrets, HIGH) was
fixed inside 040 itself with its portal and admin extension closed as #491.

That is the structural point worth recording, because it changes what criterion
3 is actually about. The August pass left named one-off findings. This pass
leaves none: what remains is a **continuously refreshed scanner feed** on two
standing tickets, and the question criterion 3 now asks is how to read a
scheduled scanner's output, not whether a defect is outstanding. Section 5.1
puts that reading to the Code Owner rather than deciding it.

---

## 3. Traceability: SEC-1 to SEC-17

The criteria in the work order say "SEC-1 to 13". **SEC-14 to SEC-17 now exist**
and `docs/SECURITY_DESIGN.md` section 10 is the authoritative matrix, so every
row it carries is covered here. Verdicts are about **this tree**, on the
evidence named. "Verified" means an executable assertion exists and was seen to
run, by this pass or by a cited review at a named head.

| Control                             | Verdict                                                 | Evidence and deviations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-1** admin authn + 2FA         | **Verified, carried forward**                           | August pass section 4, re-run by `api-e2e` on every push. Its one deviation is closed: #390's throttle no longer keys on `NODE_ENV`. 061 adds the provisional bootstrap credential that must be changed first. **Deviation retained: recovery codes are stored encrypted rather than hashed** (recorded in design section 2.1; a deviation from NIST SP 800-63B and ASVS). Residual: #1088 item on the dev harness printing the first admin's password outside CI (section 5).                                                                                                                                                   |
| **SEC-2** respondent tokens + links | **Verified, with two recorded deviations**              | August pass section 4. 066 adds the environment to the link: `apps/api/src/features/links/schema.ts` refuses a mint with no environment, asserted at #1060's criterion 6. **Deviations, both open and both documented against the design rather than discovered here: the portal session cookie is not path-scoped per form and environment (#1081), and its lifetime is fixed at 24h rather than tracking the session TTL (#1079).** Both are same-browser self-collisions; neither crosses a respondent boundary.                                                                                                              |
| **SEC-3** authorization matrix      | **Verified, and materially strengthened**               | `apps/api/e2e/security/01-authorization-matrix.e2e.ts` plus `surfaces.ts` and `matrix-coverage.e2e.ts`. 069 replaces "the admin group is gated" with a **route-policy table that fails closed**: section 4.1. The August pass's section 7 observation against the section 3.2 table (the service token alone reaches `POST /sessions`, by design) still stands and is still recorded in the suite rather than by editing a cell.                                                                                                                                                                                                 |
| **SEC-4** service channel auth      | **Verified, carried forward**                           | August pass section 4. The channel token is mounted ahead of the admin session gate and the grant check, registrar order `apps/api/src/registrars.ts`, confirmed by #1061's probe that a 401 precedes anything else.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **SEC-5** `/api/v1` scopes          | **Reserved, unbuilt, by design**                        | Scope annotations present as OpenAPI metadata and inert at launch. #11 and #9 record two annotations that over-grant on paper and are a one-line change when the scopes activate. Not exercised, which is what the design says.                                                                                                                                                                                                                                                                                                                                                                                                  |
| **SEC-6** webhook signing           | **Verified, and now under an application control**      | August pass section 3.5: one signature per delivery, four tamper classes and a replay rejected, the documented hard cutover asserted. **070 adds the two-person rule above it**: in a workspace that requires a second approver a `prod` endpoint change is held in `control.webhook_endpoint_proposals` and reaches no endpoint row until a different `forms.approver` confirms it (#1100, section 4.4).                                                                                                                                                                                                                        |
| **SEC-7** key inventory + rotation  | **Verified in part, carried forward**                   | August pass section 4: rotation overlap asserted as a running process for session keys, link keys and the internal token, with the discriminator that makes it mean something. **Not verified, and the design records it as impossible at launch: retiring an admin auth-secret version.** #466 records the same shape for `QCMS_APP_KEY`: one scalar, no key id in the envelope, so there is no online re-encrypt path for a stored webhook secret. #1035 records the portal image's Server Action salt as a build arg.                                                                                                         |
| **SEC-8** secrets + redaction       | **Verified, and extended twice since August**           | Placeholder secrets refuse boot; `check:security-hygiene` runs in `check:all` and in `verify (node-24)`. **067, #1099 and #1101 build out the credential-free statement path**: `packages/db/src/environment/role.ts`'s `refuseWithoutStatement` (line 156) rethrows subject and act with no `cause` and no statement text, reproduced on the built CLI by #1093 and #1099, and #1101 brought the last three catalogue reads inside it. **One narrow residue, not a credential path:** drizzle's own `begin`, `commit` and `rollback` sit outside any wrapper. Section 4.3.                                                      |
| **SEC-9** transport/browser         | **Verified, and extended to the portal's actions**      | August pass section 3.4: headers on served, refused and 404 responses; no CORS header on any response or preflight; the body cap enforced at 413 before the credential gate. **The portal's Server Action same-origin change is new and is gated**: section 4.5. **Deviation retained: HSTS is emitted only by the ingress, by design (ADR-20).**                                                                                                                                                                                                                                                                                |
| **SEC-10** least-privilege DB roles | **Verified; the August gap is closed**                  | The August pass recorded the app and migration split as absent in code. It shipped (#492) and the model has since grown twice: **067's read-only role per (workspace, environment) with `security_barrier` views** (section 4.2) and **#1099's one re-grant source for the restore path** (section 4.3). `apps/api/e2e/security/03-db-least-privilege.e2e.ts` and `04-db-restore-regrant.e2e.ts` are both in the required `api-e2e` context.                                                                                                                                                                                     |
| **SEC-11** supply chain             | **Partly verified. The one criterion still open.**      | The August pass called this the largest evidence gap and three of its four parts have closed: base digests are pinned beside their tags with Dependabot container coverage (#372), the SBOM's contents are asserted rather than its existence (#877), and image scanning runs weekly over the persisted SBOMs (#894). Third-party actions are pinned to a full commit SHA with the release in a trailing comment (#948, #1078), enforced by `scripts/check-actions-pinned.test.ts`. **Provenance publishing is the residue: section 7.**                                                                                         |
| **SEC-12** review + disclosure      | **This document, plus `SECURITY.md`**                   | Section 8 for `SECURITY.md` and the live ruleset; section 9 for the exit criteria.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **SEC-13** telemetry privacy        | **Not re-verified here, same as in August**             | Rests on tasks 054 and 062's own suites. 067 adds `qcms.environment` on a span and `environment` on a log record, both allowlisted, and #1093 confirmed neither names a respondent. The August pass's carried-forward note on two retention-sweep messages exporting as `application.event` was ticketed as #490 and **is closed**.                                                                                                                                                                                                                                                                                              |
| **SEC-14** environment isolation    | **Verified by probe. New since August.**                | Section 4.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **SEC-15** access audit             | **Verified by probe. New since August.**                | Section 4.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **SEC-16** repeating-group bounds   | **Built; not independently re-probed here**             | Decided 2026-09-29 (ADR-42, ADR-43) and delivered by tasks 071 to 077, all `done` in the ledger. The bounds are kernel-side and their assertions run in `verify (node-24)` and `api-e2e`. **This pass did not probe them and does not claim to have**: no reviewer comment in the cited set covers SEC-16, and the ten reviews read here are the environments track. Recorded as a bounded gap in section 10.                                                                                                                                                                                                                    |
| **SEC-17** agent action surface     | **Decided, not built. Out of scope at launch default.** | ADR-25 as amended 2026-10-19, phases C and D of `plan/agent-everywhere.md`, which #1109 has since numbered as work orders **082** and **083** and put on the launch gate. The default is `QCMS_FLAG_AGENT_AUTHORING=none`, which mounts nothing: `apps/api/src/config.ts` and the early return in `apps/api/src/features/forms/assist/route.ts`. 069 nevertheless gave both flag-gated assist routes policy rows derived from their own declared scopes, and #1061 verified at runtime that a `forms.viewer` is refused 403 on both with the flag on. **The flag is set in no shipped Compose file, template or image** (#1061). |

---

## 4. The post-August surfaces, at ASVS L2 depth

Recorded at **chapter level rather than by requirement number**, for the reason
the August pass gave: ASVS 4.0.3 and 5.0 number these differently, and this
document should cite what was checked rather than invent identifiers. The
chapters the work order names are authentication, session, access control,
validation and error handling.

### 4.1 The authorization middleware and its route-policy table (069, SEC-3)

**Access control.** This is the largest change to SEC-3 since the matrix suite
was written, and it moves the model from "the admin group is gated" to "every
admin route is named in a table and an unnamed one is refused".

- **It fails closed, and that is a runtime property rather than a table
  property.** `isRoutedAdminPath` asks Hono what matched rather than asking the
  table (`apps/api/src/features/membership/middleware.ts`), and the registrar
  order puts the gate third, ahead of every slice
  (`apps/api/src/registrars.ts`). #1061 probed a mounted admin route the table
  has never heard of and got **403 `ROUTE_NOT_AUTHORIZED`**; a genuinely
  unrouted path got 404; and **deleting the `GET /admin/workspaces` row from
  `ROUTE_POLICIES` at runtime turned a working 200 into a 403**. Still present
  at the tree reviewed: `ROUTE_NOT_AUTHORIZED` at `middleware.ts:73`, and
  `route-policy.ts` is 796 lines.
- **The environment a request acts in is read from exactly one declared
  source.** `environmentFrom` is declared on all **18** `namesEnvironment` rows
  and on no other (5 `"body"`, 13 `"switcher"`; 15 and 15 was true at #1061's
  head `e6e71a54`, and #1100 added the propose, confirm and withdraw rows), and
  `environmentFor` reads the declared source with no fallback:
  a `body` row refuses an empty body with 400 rather than falling back to the
  switcher, and refuses a body naming an environment on a `switcher` row.
  #1061's probe ran **nine request shapes against each of four routes with a
  `test`-scoped credential and a `prod` target** (no body; a forged body; a
  header and body disagreeing; a JSON array body; the same JSON under
  `text/plain`; a query-string override; an uppercased header; a whitespace
  padded header) and got **27 of 27 refused, 403 or 400, with the production
  link still active and the production webhook still live afterwards**. The
  positive control in the same run is what makes that mean something: the same
  route as a fully credentialed admin answered 200 and did revoke the link.
- **A second authorization cell is evaluated before any handler runs.** The
  `publish-and-release` row carries `also: { resource: "release", action:
"create" }`, and the middleware evaluates it against the same workspace and
  the same body-named environment. A `test`-scoped editor sending
  `{"environment":"prod"}` gets 403 naming `release: create`.

**One latent gap, open as #1062, and unreachable today.** A routed admin
template ending in `*` is the one shape `isRoutedAdminPath` classifies as
unrouted, and it would be served with no grant check. It is not reachable at
the tree reviewed: every admin route registers through `group.openapi(...)` with a
concrete OpenAPI path, and the only path-scoped `use` in the admin group is the
assist limiter at a concrete path. #1061 recommended an issue rather than a
change in that pull request, and #1062 is it. Severity LOW in section 5, with
the reason stated there.

### 4.2 Per-workspace reporting roles with `security_barrier` (067, SEC-10)

**Access control, at the database rather than in the application.** A read-only
role per (workspace, environment) reads its own two views and nothing else.

The property that matters is not the grant, it is that the view cannot be
**bypassed** by a consumer writing their own SQL, and #1093 established it by
reproduction **with a negative control**, which is the part that makes it
evidence:

- against a throwaway `postgres:16-alpine` with the branch's migrations applied
  and the generated DDL for two workspaces, connected as
  `qcms_reporting_prod_home` with exactly the generated grants, a cheap plpgsql
  qual under `join_collapse_limit = 1` printed **only** the role's own
  workspace's answer, and the division-by-zero oracle raised nothing;
- **the same pair re-emitted without the option, created beside the real one
  and granted to the same role, leaked the other workspace's answer through
  both views and raised `division by zero`.** Same role, same session, same
  data; the option is the only difference;
- **mutation of the shipped test**: removing `WITH (security_barrier = true)`
  from `packages/db/src/reporting-views.ts` and rebuilding turned
  `03-db-least-privilege.e2e.ts` red at exactly the four new cases.

Still present at the tree reviewed: `reporting-views.ts:434` emits
`CREATE OR REPLACE VIEW ${target} WITH (security_barrier = true) AS`.

**One residual channel, recorded rather than closed, and not a finding.**
`EXPLAIN (ANALYZE)` on the consumer's own query is a cardinality and existence
channel that `security_barrier` does not close: a plain equality on a text view
column is pushed into the base scan because `texteq` is `leakproof`, so the plan
distinguishes "this session id exists here and is not mine" from "it does not
exist", and reports the environment's total submitted-session count. **No answer
value leaks**: `jsonb_eq` is not `leakproof`, so a guessed-value predicate stays
above the barrier, and #1093 measured the plans for a correct and a wrong guess
as byte-identical. It is a covert channel of counts and existence over
high-entropy identifiers the consumer does not hold, inherent to
`EXPLAIN ANALYZE` rather than to this design. #1093's recommendation was one
sentence in `docs/reporting-view.md` saying plan cardinalities are outside what
the option covers. **That sentence is still not there**, so this pass
carries the recommendation forward as a lane follow-up in section 11.2 rather
than reporting it as done.

### 4.3 SCRAM role passwords and the credential-free error path (067, #1099, SEC-8)

**Error handling, and cryptography.** A role password never reaches the server
as plaintext and never reaches an error message or a log line.

- **The verifier is correct, proved by re-derivation rather than by inspection.**
  #1093 created a role through the built `createLoginRole` against a real
  server, then independently re-derived the secret with `node:crypto` from the
  stored salt: `SaltedPassword = PBKDF2-HMAC-SHA-256(password, salt, 4096, 32)`,
  `StoredKey = SHA256(HMAC(SaltedPassword, "Client Key"))`,
  `ServerKey = HMAC(SaltedPassword, "Server Key")`, checked against RFC 5802
  section 3, RFC 7677 and PostgreSQL 16's own format. Both keys reproduced
  exactly, the format matched
  `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` at 4096 iterations
  and 16 salt bytes, and **the role logged in with the plaintext**, which is the
  only proof the derivation is right. The password used included a space, a
  hyphen and `!~`.
- **The plaintext reaches no log.** The server statement log recorded only the
  verifier; `grep -c` for the plaintext in the container log was 0.
- **The refusal path carries nothing.** A role created `LOGIN` with no
  `CREATEROLE`, which is the shape `docker-compose.yml` gives `qcms_migrate`,
  produced `could not create the role <name>: permission denied to create role`
  with no password, no `CREATE ROLE`, no `Failed query`, no `params` and **no
  `cause`**, which matters because `describeError` appends a cause's message to
  the line it prints.
- **#1099 generalised the wrapper and reproduced the same property on the
  re-grant path**, on the built CLI with `control.access_audit` renamed so one
  source fails: `qcms-db environment failed: could not re-apply
control.access_audit (migration 0004): relation "control.access_audit" does
not exist`, and nothing else.

**The overstatement #1099 recorded is closed, and its successor is narrower.**
#1099's finding 1 was that three catalogue reads ran **outside** the wrapper
(`listEnvironmentNames`, the `listWorkspaces` reads and
`publicCreateGrantedToPublic`), so four sentences in the tree claimed more than
was true. **#1101 wrapped all three** and this pass re-read them at the tree
reviewed:
`packages/db/src/environment/regrant.ts:172`, `:189` and `:218`, each a
`refuseWithoutStatement("read", ...)`. #1101's reviewer proved the test behind
them is not vacuous by unwrapping one and watching **exactly one** case go red on
`AssertionError: stderr must not carry /Failed query/`.

**What remains is a third-order residue that this document records rather than
reports as a finding.** #1101's own reviewer found it: `exec.transaction` at
`regrant.ts:194` is not inside the wrapper, and drizzle 0.45.4 issues `begin`,
`commit` and `rollback` through its ordinary execute path, so a connection that
dies at `BEGIN` prints `Failed query: begin`. That is a statement in an error
path and the four sentences now say "every database call". **It is not a
credential path and SEC-8 is untouched**: the statement text is the word `begin`,
with no parameter and no input, and SEC-8's requirement is "a credential never
reaches statement text" (`docs/SECURITY_DESIGN.md`). Two further residues from
the same review are latent only: the grant-model wrap would replace a
cause-free error's own sentence with "the database refused it", which nothing in
`regrantPasses` throws today, and `regrant.ts:185-188` says the failing source is
named when the refusal it produces names none. **Judgement: none of the three is
worth a change before the gate.** Either wrapping the transaction or narrowing
the sentence to "every call this module issues" closes the first, and section
11.2 carries it as a lane follow-up rather than as a blocker.

### 4.4 The two-person rule for production (070, SEC-6, SEC-15)

**Access control, and separation of duties.** In a workspace that requires a
second approver, a `prod` endpoint change is held as a proposal and reaches no
endpoint row until a different `forms.approver` confirms it.

#1100 verified it over HTTP and in the browser, and the parts that are
security-load-bearing are:

- **the proposer cannot confirm their own change**, refused 403
  `PROPOSER_CANNOT_CONFIRM` at `apps/api/e2e/security/01-authorization-matrix.e2e.ts`,
  and refused on **both** the pre-apply branch and the already-applied branch;
- **the state machine cannot be wedged open and cannot double-apply.** The
  database CHECK is `applied_at is null or withdrawn_at is null`, the partial
  index that claims the endpoint and the predicate that can end the row are the
  same one, an applied proposal is 409 on withdraw, and the concurrent-resume
  path catches `23505` off the table's only unique constraint so it cannot mask
  a different conflict;
- **no environment role can see or touch the proposal table.** #1100's third
  mutation granted it to an environment role **in the migration and in the grant
  registry with byte-identical text**, so both text-direction assertions still
  passed and the catch had to come from a real catalogue: `03` and `04` went red
  at 7 of 147, naming "holds nothing at all on the pending prod endpoint change";
- **SEC-15 rows exist for propose, confirm and withdraw** (Q61, Q79), asserted
  in `apps/api/src/features/webhooks/webhooks.integration.test.ts` and in `01`.

**Both residues #1100's review recorded are closed by #1102, and the second one
mattered.** The first was prose: a docblock named the wrong mechanism for the
applied-withdraw refusal. It now traces the refusal to the one guard that answers
it, a 409 on `appliedAt !== null` at
`apps/api/src/features/webhooks/handler.ts:675`, and names the statement
predicate (`isNull(appliedAt)`) and the `one_outcome` CHECK as standing behind
rather than in front of it. **The second was a coverage gap on a
separation-of-duties rule**: the proposer arriving at an **already applied** row
had no test, so the line that keeps "two accounts" true after the change lands
rather than only up to it was unasserted.
`apps/api/src/features/webhooks/webhooks.integration.test.ts:572` is that case,
and #1102's reviewer proved it is the only one on that branch by replacing the
refusal with a comment and watching **exactly one** test go red on
`expected 200 to be 403`.

**Worth stating plainly, because it is the shape a sign-off should care about.**
Nothing was broken: the refusal worked before #1102 and works now. What was
missing was the assertion that would notice if it stopped, on a control whose
whole value is that one account cannot bypass it. A review that had read only the
code would have called SEC-6 and SEC-15 verified here, and been right about the
behaviour and wrong about the guarantee.

### 4.5 The portal's Server Action same-origin change (SEC-9)

**Access control at the browser boundary, and the CSRF belt.**

The portal's no-JS Continue path is a Next Server Action (ADR-43's amendment of
2026-10-01, `docs/adr/portal.md:116`: a page answers GET and HEAD only, a route
handler cannot render the page, and a segment holds a `page` or a `route` and
not both, so a Server Action is the framework's only answer). That changes the
CSRF surface, because the belt was written for route handlers.

**What holds it is a derived repository-level gate, not a convention.**
`scripts/check-origin-guards.test.ts` enumerates every `"use server"` module in
both Next apps from git, not from a directory walk, and asserts that every
state-changing action calls `isSameOriginPost`. It exists because the exact
failure it catches already happened: the design asserted the Origin and
`Sec-Fetch-Site` check of both apps while it was true of the admin and false of
the portal, for four tasks and four handlers (#487). The gate runs in the
`tooling` vitest project, which runs from the repository root and outside turbo,
so it is never served from cache and always sees the tree as it is.

**The referrer policy moved to admit it, and the gate pins that too.**
`Referrer-Policy: no-referrer` serializes `Origin` as the literal `null`, which
would lock out the very path the Server Action exists for, so the portal serves
`same-origin` while the admin keeps `no-referrer`. Both are asserted by name at
`scripts/check-origin-guards.test.ts:498` and `:502`, read out of each app's own
proxy rather than from a comment.

**Two things this pass records rather than closes.** #1024 asks for the portal's
origin-belt lockout to be re-measured under `same-origin` rather than inheriting
#504's 1.6% figure, which is now an upper bound; the belt rule itself is
unchanged and still enforced. And #1035 records that a stale Server Action id
after a deploy answers Next's own 409 or 400 rather than a page the app owns,
which is accepted behaviour under ADR-43's amendment, with the full-stack suite
already asserting that no session id and none of Next's deployment wording
reaches the respondent.

**The Next 16.4 move is the reason the second one is 409 rather than 500.**
`apps/portal/package.json` and `apps/admin/package.json` both read
`"next": "16.4.2"`. ADR-43's amendment of 2026-10-10 records the measurement
behind it: at 16.4.0 a well-formed but unknown action id answers **409** with
`x-nextjs-action-not-found: 1`, and a malformed one **400**, identically on the
no-JS multipart path and the fetch path. That is a security-relevant
improvement, because the prior behaviour was an uncaught throw answering 500,
and it is recorded with its upstream pull request and the date it was measured.

### 4.6 Environment isolation at the network layer (SEC-14)

**Access control, deny by default, and 404 rather than 403.**

Three mechanisms, all built and all asserted:

- **the mount split and the `/<env>/` address prefix** in
  `apps/api/src/app.ts`, with the portal's two refusals in
  `apps/portal/proxy.ts`. The 404 assertions are in
  `apps/api/src/features/responses/start-session/environment-addresses.integration.test.ts`
  and `apps/portal/proxy.test.ts`, and #1060 confirmed the criterion by name: no
  anonymous entry to a non-prod environment, **a 404 and not a 403**, and
  `/<env>/f/{slug}` does not exist. The operator half is
  `docs/deploy-ingress.md`;
- **per-environment egress** (067): the endpoint, outbox and delivery tables are
  per environment, so a `test` deliverer cannot read a `prod` endpoint row.
  Asserted against a real Postgres in
  `apps/api/src/schedulers/every-environment.integration.test.ts`, whose
  assertion #1044 rebuilt to stop reading a clock and then proved with two
  mutations: restricting the fan-out to one environment, and throwing inside the
  swallowing `try`, each failing at a pass assertion rather than at a row. The
  firewall half is `docs/operations.md`'s outbound-network section;
- **the two-person rule above it** (070, section 4.4), which is what makes the
  allowlist the network backstop under an application control rather than the
  only control there is.

**What this layer does not protect against is written down** in
`docs/SECURITY_DESIGN.md` section 5a's own closing subsection, and this pass did
not widen that claim.

### 4.7 Access audit for response data (SEC-15)

**Error handling and accountability, and the one chapter nothing covered before 069.** Every control before it governs **whether** somebody may read a response.
Nothing recorded **that they did**.

- `control.access_audit` in `packages/db/src/schema/control/access-audit.ts`,
  with the six kinds pinned by a CHECK;
- the **no-`RETURNING`** helper in `packages/db/src/queries/access-audit.ts`
  that both pools call, so an audit insert cannot hand a row back to the caller;
- the grants and the **`UPDATE` and `DELETE` revoke** in migration 0004
  (`grantAccessAuditStatements`), which is what makes the log append-only at the
  database rather than by convention. #1100's third mutation is the evidence
  that the revoke is real;
- the per-route `audit` column in
  `apps/api/src/features/membership/route-policy.ts`, so a route either declares
  an audit kind or declares that it writes none, and #1061 pinned every endpoint
  row plus the bootstrap seed's own rows (Q70);
- 070 adds the `setting` rows for a `prod` endpoint change's propose, confirm
  and withdraw (Q61, Q79).

**One scope gap, open and accepted by ruling rather than found here.** #1095:
no command changes a per-environment setting after create, so an operator does
it with a raw `UPDATE control.environments` under the migration credential and
**no audit row is written**. The Code Owner ruled on 2026-10-22 (PR #1093) that
this is #1095's work and not 067's. It is a real gap in SEC-15's coverage of a
privileged act, and it requires the migration credential, so it is an
accountability gap and not a privilege escalation. MEDIUM in section 5.

### 4.8 Chapters carried forward unchanged

**Validation.** Every route body and query is still a Zod schema at the boundary
through `@hono/zod-openapi`, bodies are capped at 1 MB and the cap is applied
before the credential gate. 069 adds a second validation property worth naming:
the body-named environment is matched against `/^[a-z][a-z0-9]*$/` and compared
exactly, and the switcher header is trimmed and validated against the live set,
so **case and whitespace variants cannot reach a mismatch by a second door**
(#1061).

**Injection.** No `sql.raw` with interpolated input and no string-built SQL in
the application path; `scripts/check-security-hygiene.mjs` preserves the
standing part of that in CI, and it says itself that it does not cover a
statement assembled elsewhere and passed by variable. The environments track
added generated DDL, which is the one place the tree now writes SQL text, and
#1093 checked the bound rather than assuming it: the `sql.raw` call sites in
`packages/db/src/environment/` carry generated DDL and grants over **a refused
environment name and a refused slug** (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), and carry
no credential. The CSV formula-injection guard that was the August pass's open
high (#470) is closed and lives in `@roonga/qcms-csv`.

---

## 5. Open findings and severities

Severity is on the August pass's own scale, so the two documents can be read
together: **HIGH** is an absent control on an attacker-reachable path, or an
exposure an operator reaches through published material or a default
configuration. Every severity below is **a judgement**, and the reason is given
so the Code Owner can disagree with it on the facts rather than on the label.
"F" is a finding against shipped code; "H" is planned hardening, documentation
or dependency hygiene.

**No open issue is a HIGH-severity security finding on that scale.** Two are
arguably high on a literal reading of scanner output, and both are dependency
and image hygiene rather than product defects. Section 5.1 states both readings
and does not pick one.

| #                                                        | What it is                                                                                                                                                           | Severity                              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                 | F/H  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **#1054**                                                | Standing `pnpm audit` ticket. **Closed by #1107**, which moved `launch-editor` to 2.14.2                                                                             | **retired**                           | Kept in this table rather than deleted, because section 5.1's argument about it is the record of a reading the Code Owner was asked for and then retired by merge instead. The three advisories are gone from `pnpm audit` on the tree reviewed                                                                                                                                                                                        | H    |
| **#977**                                                 | Standing image-scan ticket. **3 fixable highs at 2026-10-24**, down from the 8 its 2026-10-19 run reported; 0 critical with a fix                                    | **MEDIUM** (arguably HIGH, 5.1)       | All three sit in npm's own bundled tree inside the pinned Node base image, not the application graph (the lockfile resolves `brace-expansion@5.0.12` and `undici@7/8`). No reachable path shown. Five of the eight were cleared by #1072's digest, which the 2026-10-19 scan predates; the three clear by dropping the bundled npm from the runtime stages                                                                             | H    |
| **#969**                                                 | Record the per-CVE base-image acceptance in SEC section 9, watch trixie, bump the bookworm digest                                                                    | **MEDIUM**                            | Records an accepted risk rather than removing one. **Its digest bump is not what cleared `CVE-2026-103111` against `libpcre2-8-0`**: #1072's digest did, on 2026-10-20 UTC, before #969 item 3 landed as #1108 (section 5.1). #1108 is the reproducibility result, and its own section 9 measurement records the images as moving by nothing. Items 1 and 2 of #969 remain open                                                        | H    |
| **#1095**                                                | No audited `update` subcommand for a per-environment setting                                                                                                         | **MEDIUM**                            | A real SEC-15 coverage gap for a privileged act (section 4.7). Needs the migration credential, so accountability rather than escalation. Accepted by ruling 2026-10-22                                                                                                                                                                                                                                                                 | F    |
| **#1085**                                                | Promotion provenance is not checked against the release history; raw releaser ids; rollback derived loosely                                                          | **MEDIUM**                            | Audit-record integrity on a production change: a stored release row can assert a promotion path that never happened. Needs release authority, so it is an insider-accountability defect                                                                                                                                                                                                                                                | F    |
| **#1086**                                                | The admin export route is a GET acting in the cookie's environment; destructive confirms do not name the environment                                                 | **MEDIUM**                            | A stale cookie in another tab downloads responses from the wrong environment, and a destructive confirm does not state its blast radius. Authorised operator throughout; no unauthorised access                                                                                                                                                                                                                                        | F    |
| **#1088**                                                | Admin auth-screen batch, including the dev harness printing the first admin's password outside CI                                                                    | **MEDIUM**                            | The printed credential is a real local exposure on a developer machine. The recovery-code item is an unambiguity fix and not an entropy fix                                                                                                                                                                                                                                                                                            | F+H  |
| **#1081**                                                | One portal session cookie at `path: "/"` for every form and environment                                                                                              | **MEDIUM**                            | **Deviates from a documented control**: SEC-2 says the cookie is path-scoped and it is not, so a `test` session overwrites a `prod` one in the same browser. Self-collision; no cross-respondent exposure                                                                                                                                                                                                                              | F    |
| **#1079**                                                | The portal session cookie is fixed at 24h; a 5xx during link redemption reads as "not valid"                                                                         | **MEDIUM**                            | **Deviates from a documented control**: SEC-2 says cookie lifetime tracks the session TTL, so the cookie can outlive a dead bearer. The failure copy is a correctness defect                                                                                                                                                                                                                                                           | F    |
| **#1080**                                                | Without scripting, a button labelled Continue can irreversibly submit                                                                                                | **MEDIUM**                            | Respondent **data-integrity** defect on an irreversible action. An attacker gains nothing by it, so it is arguably LOW on a scale that keys on attacker gain                                                                                                                                                                                                                                                                           | F    |
| **#466**                                                 | `QCMS_APP_KEY` is one scalar with no key id in the envelope, so there is no online re-encrypt pass                                                                   | **MEDIUM**                            | A missing **recovery** capability after a key compromise, the same shape the August pass gave #432. SEC-7 and the operations runbook already state the limitation                                                                                                                                                                                                                                                                      | H    |
| **#1062**                                                | Grant middleware classifies any `*` template as middleware; the bootstrap seed's audit row is not transactional                                                      | **LOW**                               | **Unreachable at the tree reviewed** (section 4.1): every admin route has a concrete OpenAPI path and the one path-scoped `use` is concrete. Latent, and grants nothing now                                                                                                                                                                                                                                                            | H    |
| **#971**                                                 | A third party can post a forged digest marker and suppress one scan reminder                                                                                         | **LOW**                               | The payoff is one suppressed reminder; the red job, the run summary and the artifact are untouched, and the forged comment notifies watchers                                                                                                                                                                                                                                                                                           | F    |
| **#1084**                                                | Forms list, header and Links treat a published form as live when it is released nowhere                                                                              | **LOW**                               | Serving **is** correctly gated on release. Misreported lifecycle state and copy: an operator could believe a form is live when it is not                                                                                                                                                                                                                                                                                               | F    |
| **#1024**                                                | Re-measure the origin-belt lockout under `Referrer-Policy: same-origin`                                                                                              | **LOW**                               | The belt rule is unchanged and still enforced; this replaces an estimate with a measurement                                                                                                                                                                                                                                                                                                                                            | H    |
| **#1033**                                                | An uncovered guard branch on the forced-password-change gate; SEC-1 does not name where the enrolment secret is provisioned                                          | **LOW**                               | The guard exists and works; only its regression cover is missing. The second item is documentation completeness                                                                                                                                                                                                                                                                                                                        | H    |
| **#1035**                                                | A stale Server Action id answers Next's own client error rather than a page the app owns                                                                             | **LOW**                               | Accepted behaviour under ADR-43's amendment (Q28), and the full-stack suite asserts no session id and no deployment wording reaches the respondent                                                                                                                                                                                                                                                                                     | H    |
| **#1031**                                                | The generated env reference states the wrong default for the bootstrapped admin's name                                                                               | **LOW**                               | A generated operator reference carrying a wrong claim about a bootstrap credential path. No control affected                                                                                                                                                                                                                                                                                                                           | F    |
| **#1112**                                                | `pnpm audit` high: `zod <4.6.6` (`GHSA-mrhx-c7xc-m3w5`). **Closed by #1114**, which moved `chromium-bidi` to `157.0.8090-0` and left `zod` at a single patched 4.6.7 | **retired**                           | Kept rather than deleted because its reasoning is on the record beside #1054's: dev-only through the root devDependency `lighthouse`, in no shipped image and no published package, and it needed the **upstream** half of CONTRIBUTING's choice rather than an override, so `pnpm-workspace.yaml`'s override block is unchanged at its five lines, which is section 5.2's four table rows. `pnpm audit` is clean on the tree reviewed | H    |
| **#1111**                                                | The `brace-expansion@5: ^5.0.9` override floor has lapsed behind two newer advisories                                                                                | **LOW**                               | The floor admits 5.0.9 and 5.0.10 while `GHSA-6j4f-fj2g-mc7p` and `GHSA-qhr7-859c-m2p7` are fixed at 5.0.10 and 5.0.11, so the entry permits part of what it exists to exclude. **Nothing vulnerable is installed**: the lockfile resolves 5.0.12 only, so what lapsed is the floor as a guarantee rather than the tree (section 5.2). Found during #1108                                                                              | F    |
| **#1110**                                                | The `qcms-api` Vitest project sets no `hookTimeout`, so a container teardown gets Vitest's 10s default                                                               | **LOW**                               | Evidence integrity rather than a control: a teardown that times out after every test in the file has passed turns a green suite into a red `pnpm verify`, which is indistinguishable from a regression until the file is rerun. Confirmed at `vitest.config.ts`, where `hookTimeout` is set for `qcms-api-e2e` (240s) and `create-qcms-app-e2e` (120s) and for no other project. Same class as #989, #1025 and #1029                   | F    |
| **#311**                                                 | The webhook signature mask is a call-site convention rather than a structural invariant                                                                              | **LOW**                               | Correct at every current call site and pinned by an assertion on the serialized column. A future-caller risk with no present exposure                                                                                                                                                                                                                                                                                                  | H    |
| **#982**                                                 | An adopter example names actions by tag in a document nothing bumps                                                                                                  | **LOW**                               | The ageing-pin case SEC-11 warns about, in an example document rather than in a workflow                                                                                                                                                                                                                                                                                                                                               | H    |
| **#342**                                                 | Image supply-chain follow-ups: `imageTag()` is not injective, `dist-images` is not ignored                                                                           | **LOW**                               | Supply-chain **auditability**. Its own closing paragraph about floating base tags is stale: all three Dockerfiles now pin a digest                                                                                                                                                                                                                                                                                                     | H    |
| **#816**                                                 | Scaffolds install five AI SDK packages unconditionally                                                                                                               | **LOW**                               | Install weight and advisory surface for packages an adopter never loads; they are dynamically imported, so a `provider=none` deployment loads none                                                                                                                                                                                                                                                                                     | H    |
| **#1087**                                                | Admin authoring and response-screen polish, including unnamed destructive row actions                                                                                | **LOW**                               | Display and confirmation clarity. The logging rule and R6 are explicitly untouched                                                                                                                                                                                                                                                                                                                                                     | H    |
| **#360**                                                 | Nothing is published, so provenance publishing cannot be configured or exercised                                                                                     | **Not a finding. Criterion 4 unmet.** | No control is absent in the product. It is the gate item itself, and a Code Owner action. Section 7                                                                                                                                                                                                                                                                                                                                    | gate |
| **#11**, **#9**, **#201**, **#283**, **#876**, **#1009** | Phase-4 scope annotations, a parked OpenAPI route, an operator-visibility gap, a health endpoint shape, a documentation-integrity gate                               | **INFORMATIONAL**                     | None implicates a control at launch. The SEC-5 scopes are inert because `/api/v1` is unbuilt                                                                                                                                                                                                                                                                                                                                           | H    |

**Eight further issues are security-adjacent without being product findings**,
and they are about whether this pass's own evidence can be trusted rather than
about a control: #989 and #1029 (a reviewer's `pnpm verify` can replay a shared
turbo cache, so only a forced run is the reviewer's own result), **#1025**
(`verify:browser:wait` reports "Nothing has failed" while the run log already
shows failed tests, which is the same class and the sharpest of the three: a gate
that misreports its own result is the one failure mode a sign-off cannot
compensate for), #984 (`verify` goes green below the engines floor), #981 (the
kernel coverage threshold is enforced by nothing CI runs), #992 (a bounded outbox
pass green by a margin of one event), #986 and #985 (Dependabot-lane process).
All INFORMATIONAL as security findings, and all relevant to how a sign-off should
read a green gate.

### 5.1 The two arguably-HIGH readings, stated both ways

Criterion 3 says "zero open high-severity findings". Two standing scanner
tickets make that reading load-bearing, so both readings are given and neither
is chosen here.

**#977, the weekly image scan. The figure has moved since the scan this document
first quoted, so both readings are given with their dates.** The **2026-10-19**
run reports, per image, 0 critical with a published fix, **8 high with a
published fix**, and 223 findings with none, including two criticals Debian has
tagged `wont-fix`. **At 2026-10-24 the fixable-high count is 3, not 8**, and the
reason matters more than the number:

- **Five of the eight were already cleared on `main` before this document was
  written**, by #1072's base digest bump, which merged **2026-10-20T20:43:26Z**
  and which the 2026-10-19 scan therefore predates. (An earlier draft dated that
  merge 2026-10-21, which is its local date on this host and not what the API
  returns. It is given here as a timestamp because the ordering against the
  2026-10-19 scan is what the sentence rests on; elsewhere this document
  identifies a merge by its SHA and gives no date, having had five of them a day
  out before dropping them.) `libpcre2-8-0` at `10.42-1+deb12u2` clears
  `CVE-2026-103111`, and a bundled npm tree at `brace-expansion 5.0.9`,
  `ip-address 10.5.0` and `tar 7.5.22` clears `GHSA-mh99-v99m-4gvg`,
  `GHSA-rgw5-rvv9-x895`, `GHSA-mwp4-54f8-5fhr` and `GHSA-r292-9mhp-454m`. So the
  8 was stale on arrival rather than wrong: a weekly scan's number is a reading
  at a date, and `main` had moved under it.
- **Three remain, and #1108 did not retire them**, which its own measurement
  stated before it merged as `4c898409`: `GHSA-6j4f-fj2g-mc7p` and `GHSA-qhr7-859c-m2p7` against
  `brace-expansion@5.0.9` (fixed in 5.0.10 and 5.0.11), and
  `GHSA-rfgv-xxqx-mfg5` against `undici@6.28.0` (fixed in 6.28.1). All three sit
  in **npm 11.19.1's own bundled tree** under
  `/usr/local/lib/node_modules/npm`, which is the npm that Node 24.22.1 bundles.
  Nothing in this workspace reaches them: the lockfile resolves
  `brace-expansion@5.0.12` and `undici` at 7.x and 8.x.
- **#1108 was a reproducibility result rather than a findings result**, and said
  so: it moved the digest and deleted #1048's `--only-upgrade perl-base` layer,
  so the three images are reproducible from the pinned `FROM` digest alone again
  (SEC-11, #372). The findings count it inherits is 3 either way.
- **The three clear by removing the bundled npm**, which the Code Owner ruled on
  2026-10-24. They are not reachable from any application path, so this is a
  surface reduction in the image rather than a fix to code QCMS calls.
  **The change is ruled and not started**: there is no branch and no pull
  request, because the same day the Code Owner directed that work in progress be
  finished and nothing new begun. It is therefore the one item criterion 3 waits
  on that nobody is currently doing, and section 11.1 says so.

The two readings below were written against the 2026-10-19 figure and are kept
as the record of the argument, because the Code Owner's answer was to retire the
ticket rather than to choose between them. Read them as what was weighed, not as
a live question.

- _Reading it MEDIUM:_ every fixable high is an operating-system package or npm's
  own bundled tree inside the pinned Node base image, not code the application
  calls. The lockfile resolves `brace-expansion@5.0.12` and `undici@7` and `8`,
  so the versions the scan names are inside the base image and outside what a
  workspace override can reach, which is exactly what #969 item 3 says. The
  blocking floor the repository chose is clean, and the unfixed set is an
  accepted risk with a per-CVE ruling behind it.
- _Reading it HIGH:_ an open `security`-labelled issue listed eight
  high-severity advisories **with published fixes** in all three production
  images. Seven were npm packages (`brace-expansion@5.0.7` four times,
  `ip-address@10.2.0`, `tar@7.5.19`, `undici@6.27.0`) and the eighth the Debian
  package `libpcre2-8-0` under `CVE-2026-103111`. **Node links none of them as a
  shared library**, which an earlier draft of this bullet got wrong: the seven
  are JavaScript inside npm's own bundled tree in the Node image, and pcre2 is a
  system library the image carries rather than one the runtime loads. A
  launch-gate reader still saw the word High eight times, and the remedies were
  cheap, which argued for doing them rather than classifying around them.

**#1054, the weekly `pnpm audit`. Retired by merge, and the ticket is closed.** Measured on 2026-10-23 it reported **3 vulnerabilities, 1 high and 2
moderate**, all three against `launch-editor@2.14.1` through
`.>@changesets/cli>launch-editor`, a single resolution, dev-only, with the high
being GHSA-587h-7wmj-h5pm. **#1107 refreshed the lockfile to
`launch-editor@2.14.2` and closed #1054**, and `pnpm audit` on the tree reviewed
reports none of the three.

The analysis below is kept rather than deleted, for two reasons. It is the record
of a reading the Code Owner was asked for and then retired by merge instead of
settling, which is the more interesting outcome. And **its reasoning is the
precedent #1112 is judged against**, which is the next paragraph.

**#1112, the high that arrived with the #1107 refresh. Retired by #1114, and
`pnpm audit` is clean on the tree reviewed.** When measured at
`5379319b` it was **1 vulnerability, 1 high**, `GHSA-mrhx-c7xc-m3w5` against
`zod <4.6.6`, reached through `.>lighthouse>puppeteer-core>chromium-bidi>zod`. It
was published after #1107's own audit run, so merging #1107 closed #1054 and left
this untracked until #1112 was filed.

**#1114 took the upstream route rather than the override route**, which is worth
recording because this document framed that choice as the triage and did not
pick: `chromium-bidi` moved from `17.0.2` to **`157.0.8090-0`**, whose manifest
declares `"zod": "^4.6.5"`, so `zod` is now a **single resolution at 4.6.7**
shared by the workspace and by `lighthouse`'s subtree, and
`pnpm-workspace.yaml`'s override block is **unchanged**, at the same five lines
it carried before #1114 (which is section 5.2's four table rows, the two
`minimatch` majors sharing one). That is
the better of the two options on CONTRIBUTING's own terms, since an override is
the thing that "becomes permanent by accident" and none was added.

**LOW, on the same dev-only reasoning #1054 rested on**, and each half checked
here rather than taken from the issue: `lighthouse` is a **root devDependency**
(`package.json:100`), so the path is in no shipped image and in no package this
repository publishes; and the two `zod` resolutions are cleanly separated,
which `pnpm why -r zod` shows: **`zod@4.6.7`** is the workspace's own, declared
`^4.6.7` by `packages/core`, `packages/ui`, `apps/api` and `apps/portal` and
already patched, while the flagged copy is **`zod@3.25.76`**, reached only
through `chromium-bidi@17.0.2 > lighthouse@13.5.0 > the root devDependencies`.
Nothing QCMS ships or calls reaches it.

**What made it harder than #1054, since the analysis is the precedent and not
just history.** #1054 was CONTRIBUTING's stale-lockfile case, so one refresh
closed it. This was not: `chromium-bidi@17.0.2` declared `"zod": "^3.24.1"`, read
from its installed manifest, and that range **could never reach 4.6.6**, so no
refresh of that dependency as it stood could fix it. The two ways out were an
upstream move or a scoped override, and #1114 took the first. The reasoning that
identified which case it was is CONTRIBUTING's own instruction to **check the
parent's declared range before proposing an override**, which is the rule #1050
was written to establish and which held here for the second time.

**The platform scope, per advisory, because an earlier draft of this section got
it wrong and the reading rested on it.** That draft said all three are
Windows-specific. Two are; the third is not, and the correction is kept here
rather than quietly applied, because this is the sentence the Code Owner was
being asked to rule on.

| Advisory            | Severity | Platform scope, from its own impact section                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-587h-7wmj-h5pm | high     | **Windows only.** "Only apps that runs on Windows is affected": `fs.existsSync` accepts a crafted path ending `\..:line:column` as an existing parent directory                                                                                                                                                                                                                                                   |
| GHSA-698v-4r3x-3vcv | moderate | **Windows only.** "The user uses Windows": `escapeCmdArgs()` omits `%` escaping when passing an argument to `cmd.exe`                                                                                                                                                                                                                                                                                             |
| GHSA-r825-w8mm-5pxw | moderate | **Not Windows-specific.** Three conditions, all required: an attacker can create a filesystem entry starting with `+` or `-` in the working directory; the editor is Vim, gVim, MacVim, Emacs, Emacsclient or Notepad++; and the first argument can start with `+` or `-` **or** the user is on WSL. WSL is one alternative in the third condition, not a precondition, so Vim or Emacs on any platform qualifies |

- _Reading it MEDIUM, on the basis that survives the correction:_ the dependency
  is **dev-only**, reached once through `@changesets/cli` and present in **no
  shipped image and in no package this repository publishes**, so nothing an
  adopter installs or runs carries it. Exploiting any of the three needs an
  attacker who can already write a file into the working directory of a
  developer's checkout, which is a position from which the lockfile itself is the
  easier target. And the fix needs no override: the parent's declared range
  already admits it.
- _Reading it HIGH:_ `pnpm audit` printed `high: 1` when this was written, and
  #1054 was the standing ticket for that output. Read against scanner output
  rather than against reachability, that was an open high. The one high of the
  three was GHSA-587h-7wmj-h5pm, which **is** Windows-only.

**The fix for #1054 was one command and needed no override, which this pass
checked rather than assumed, and which #1107 then did.** `@changesets/cli@3.0.3` declares
`"launch-editor": "^2.14.1"`, which **already admits** the patched line, so this
is CONTRIBUTING's stale-lockfile case and not its override case:
`pnpm update -r --depth Infinity launch-editor` followed by
`pnpm why -r launch-editor` ending in `Found 1 version` closes it. That is the
lesson #1050 recorded, applied before proposing an override rather than after.

**This pass did not make either change.** Both are dependency changes with their
own gates, outside a documentation and tooling change's scope, and the severity
reading is the Code Owner's. Section 11 carries both as decisions.

### 5.2 Documented exceptions, checked for lapsed conditions

The work order asks for documented exceptions with expiry dates, and
`CONTRIBUTING.md`'s security-overrides table is where they live. **It records
removal conditions rather than dates**, deliberately: "An override with no
removal condition becomes permanent by accident". Four entries, each read on
2026-10-23:

| Override                                 | Removable when                                                                                                 | State                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postcss: ^8.5.23`                       | Next stops pinning `postcss` exactly                                                                           | Condition **not met**; Next still pins it. Live                                                                                                                                                                                      |
| `minimatch@5` and `minimatch@9: ^10.2.5` | `archiver` or `testcontainers` reach minimatch 10, or a `brace-expansion@2: ^2.1.4` override replaces the pair | **Its stated premise has lapsed and the table says so**: both advisories are backported to the `^2` line at 2.1.4, so the pair could be replaced without crossing a minimatch major. Not a lapsed floor; a now-unnecessary override  |
| `brace-expansion@5: ^5.0.9`              | minimatch's own floor reaches 5.0.9                                                                            | **Its floor has lapsed (#1111, found 2026-10-24).** `^5.0.9` admits 5.0.9 and 5.0.10, and two advisories newer than the row's two are fixed at 5.0.10 and 5.0.11. **Nothing is vulnerable today**: the lockfile resolves 5.0.12 only |
| `esbuild@0.18.20: ^0.25.12`              | drizzle-kit drops `@esbuild-kit/esm-loader`                                                                    | Condition not met. Live                                                                                                                                                                                                              |

**One override now has a lapsed floor, and an earlier draft of this section said
none did.** That claim was true when written on 2026-10-23 and #1111 falsified it
on 2026-10-24, which is the same failure #444 describes and which CONTRIBUTING's
own rule anticipates: a floor "has to be re-checked when a follow-up advisory
lands". `brace-expansion@5: ^5.0.9` still admits 5.0.9 and 5.0.10 while
`GHSA-6j4f-fj2g-mc7p` and `GHSA-qhr7-859c-m2p7` are fixed at 5.0.10 and 5.0.11,
so the entry permits part of what it exists to exclude.

**It is LOW rather than a finding against the product, and the reason is
specific**: the lockfile resolves `brace-expansion@5.0.12` only, so no gate is
red and nothing vulnerable is installed. What has lapsed is the **floor as a
guarantee**, not the tree. The failure mode is the one #444 names: a later
lockfile refresh could land on 5.0.9 or 5.0.10 and the override would not stop
it. Raising it to the current patched line and updating the ledger row's
advisories closes it.

The minimatch pair's lapsed **premise** is a different and milder thing, already
recorded in the table by the people who wrote it, and simplifying it is hygiene.

---

## 6. Dependency and image pass

**Dependencies, re-measured rather than carried forward.** `pnpm audit` at
`541530e5`: **clean**, rc 0, `No known vulnerabilities found`. It carries to the
tree reviewed because `git diff --name-only 541530e5 <the tree reviewed> -- pnpm-lock.yaml`
is empty, checked at `92262a80`, and a reviewer re-ran the audit itself
independently on a later base and got the same. Full output under this lane's log. **The run is cited by the base it ran
on**, for the reason section 7.3 gives about the image scan: a measurement
belongs to the commit that produced it, not to whatever base the header happens
to name.

**The figure moved three times while this document was being written, and every
reading is kept, because the movement is the point and the end state is only
meaningful beside it.**

| Read at                     | Result                                   | What moved                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-23, base `7fe67b6e` | 3 vulnerabilities, 1 high and 2 moderate | all three against `launch-editor@2.14.1`, dev-only through `@changesets/cli`; tracked as #1054                                                                                                                                                  |
| 2026-10-24, base `5379319b` | 1 vulnerability, 1 high                  | **#1107** refreshed the lockfile to `launch-editor@2.14.2`, retiring all three and closing #1054. The same refresh surfaced `GHSA-mrhx-c7xc-m3w5` against `zod`, published **after** #1107's own audit run; tracked as #1112                    |
| 2026-10-24, base `541530e5` | **clean**                                | **#1114** took the upstream half of the choice section 5.1 left open: `chromium-bidi` moved from `17.0.2` to `157.0.8090-0`, which declares `zod: ^4.6.5`, so `zod` is a single resolution at 4.6.7 and **no override was added**. #1112 closed |

**Two things that are easy to miss in a clean result.** First, a dependency
figure in a dated document is a reading at a moment in a stronger sense than the
image scan's is: here **the tree moved, the advisory database moved, and both
moved inside two days**. Second, **clean today is not clean at sign-off**: the
database is fetched at audit time, so a reader must re-run it rather than quote
this line. The August pass's "0 vulnerabilities of 821 resolved" is superseded,
and so are both of this document's earlier readings.

**osv-scanner runs nowhere, and that is already recorded rather than discovered
here.** `docs/SECURITY_DESIGN.md` section 9 corrected the claim in August:
`.github/workflows/audit.yml` runs `pnpm audit`, and `osv-scanner` appears
nowhere in `.github/`. Still true at the tree reviewed. The scheduled `audit` workflow
files or updates a `security`-labelled issue on findings and is deliberately not
a per-PR gate, so a newly published advisory never blocks unrelated work.

**The image scanner is grype, not trivy, and the substitution is reasoned
rather than incidental.** The work order's deliverable says "image scan
(trivy)". `docs/SECURITY_DESIGN.md` section 9 records why grype was chosen, on a
property and not a preference: these SBOMs are produced by syft through
`docker/buildkit-syft-scanner`, and Trivy's own documentation says "Passing
SBOMs generated by tool other than Trivy may result in inaccurate detection
because Trivy relies on custom properties in SBOM for accurate scanning". grype
is syft's sibling and reads syft's conventions natively. **Recorded here as a
deviation from the work order's wording, met in substance.**

**The scan runs over the persisted SBOM rather than the image**, so it holds no
registry credential and pulls nothing, and a branch push still gets a report
although it publishes no image. `scripts/image-scan.mjs` refuses a run in which
an SBOM lists deb packages and the report names no distro, so the pass cannot
decay into a silent clean. Blocking floor `critical` with a published fix;
reporting floor `high`, fix or no fix. The 2026-10-19 numbers are in section 5.1.

**Base digests are pinned.** All six `FROM` lines in
`docker/{admin,api,portal}.Dockerfile` carry `node:24-bookworm-slim@sha256:...`
beside the tag, with `docker` and `docker-compose` Dependabot ecosystems
covering them and majors deliberately ignored on both. `docker/lgtm.Dockerfile`
and `docker/seed.Dockerfile` stay untracked because `FROM ${ARG}` is unsupported
upstream, which is recorded beside the entries.

**Third-party actions are pinned to a full commit SHA.** Every `uses:` in
`.github/` was read at the tree reviewed: the only third-party owner is
`pnpm/action-setup`, pinned to the full SHA
`ea17c68df8912ef543352723c149a84f56e3d413` with `# v6.1.0` as its trailing
comment, identically at **all eight `uses:` lines, spread over six files**
(`ci.yml` three times, and `audit.yml`, `create-app-e2e.yml`, `e2e.yml`,
`images.yml` and `restore-drill.yml` once each). The rest are `actions/*` and `github/*`, which are the
entire first-party carve-out in `scripts/actions-pinned.mjs`, plus **three** local
`./.github/actions/*` composites (`assert-no-docker-hub-pulls`,
`prepull-base-images` and `test-postgres-image`), referenced from twelve `uses:`
lines. `scripts/check-actions-pinned.test.ts` runs
this as a gate, and its reader **refuses a `uses:` line it cannot parse
canonically** rather than skipping it, which is the right default for an
inventory that must not shrink quietly.

---

## 7. Supply chain: provenance publishing (criterion 4)

**This is the one exit criterion that is not met, and it is the same blocker the
August pass recorded.** What has changed is that the prerequisites inside this
repository are now in place, so what remains is entirely Code Owner action.

### 7.1 What was found, and what this change fixes

Read at the tree reviewed, before this change:

- **there is no npm publish workflow at all.** `.github/workflows/` holds
  `audit`, `ci`, `codeql`, `create-app-e2e`, `e2e`, `images`,
  `mirror-test-images` and `restore-drill`. None publishes a package;
- **no package declared `publishConfig.provenance`**, and **npm's**
  `--provenance` appears in no workflow and in no script. The qualifier is load
  bearing: the literal string is in the tree, at `scripts/build-images.mjs:385`,
  but as buildx's unrelated `--provenance=mode=max` for the image attestations;
- **no publishable package declared a `repository` field**, which is a hard npm
  prerequisite rather than a nicety: generating provenance requires "a public
  `repository` that matches (case-sensitive)" the publishing source;
- the releases endpoint returns **0** and the tags endpoint returns **0**, with
  `git ls-remote --tags origin` empty, so there is no release, no version tag on
  `origin`, nothing published and nothing to attest. The six tags a clone
  carries are working tags from rebases and are not on the remote;
- six packages sit at `0.0.0` and `@roonga/qcms-a2ui-compiler` at `0.3.0`, with
  `.changeset/` holding the queue.

**What this change lands, because it needs no decision and the gate cannot be
met without it.** Each of the seven publishable manifests
(`packages/{core,db,ui,csv,a2ui-compiler,observability,create-qcms-app}/package.json`)
gains a `repository` object with `type`, the `git+https` URL and its
`directory`, a `homepage`, a `bugs` URL, and `"provenance": true` beside the
existing `"access": "public"` in `publishConfig`. `scripts/check-publish-provenance.test.ts`
derives the publishable set from the workspace manifests through
`trackedFilesUnder` and asserts all of it, so the next publishable package added
fails the gate until it carries the same fields rather than silently shipping
without provenance.

**`provenance: true` in `publishConfig` is a declaration and not an attempt.**
It takes effect only on a publish from a supported CI provider with
`id-token: write`; it cannot cause a local publish to fail, because npm ignores
it where no OIDC token can be minted. So landing it costs nothing and removes a
step from the Code Owner's path.

**What this change deliberately does not land: the publish workflow.** It would
have to presume four answers that are the Code Owner's, all of them #360's: that
the `@roonga` npm organisation exists, whether publishing uses a granular
automation token or a trusted publisher, what the initial version is, and
whether the first publish happens from CI or from a developer machine. A
workflow written against guessed answers could not be exercised at all until the
scope exists, and a dead workflow that nothing can run is weaker evidence than a
recipe someone follows. **Section 7.4 is that recipe, written to be applied
verbatim.**

### 7.2 Sources, with the dates they were read

Checked against current official documentation on **2026-10-23**, because the
provenance and trusted-publishing surface has moved since August.

| Source                                                                                                                                                                                                                                                    | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm Docs, [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements), read 2026-10-23                                                                                                                                    | Requires a cloud CI provider on a cloud-hosted runner; `id-token: write`; a public `repository` in `package.json` that matches the publishing source, case-sensitively; npm CLI `9.5.0+`. Opt in with `--provenance`, `NPM_CONFIG_PROVENANCE=true`, `publishConfig.provenance`, or `provenance=true` in `.npmrc`. A first publish needs `--access public` set explicitly. Under trusted publishing, "provenance attestations are automatically generated ... without requiring the `--provenance` flag"                                                                                                                                                                                                              |
| npm Docs, [Trusted publishers](https://docs.npmjs.com/trusted-publishers), read 2026-10-23                                                                                                                                                                | GitHub Actions on GitHub-hosted runners is supported; self-hosted runners are not. Configuration is **per package**, in that package's settings on npmjs.com, taking organisation or user, repository, and the **workflow filename only** (the file must exist in `.github/workflows/`); environment is optional. **"A newly created trusted publisher configuration must complete its first successful publish within 2 days"** or it expires and must be recreated. Provenance is automatic "only for public repositories and public packages". Requires npm CLI **11.5.1 or later** and Node **22.14.0 or higher**. No publish token is needed; a read-only token is still needed to install private dependencies |
| npm Docs, [`npm publish`](https://docs.npmjs.com/cli/v11/commands/npm-publish), read 2026-10-23                                                                                                                                                           | `--dry-run` "indicates that you don't want npm to make any changes and that it should only report what it would have done". `--access` defaults to "'public' for new packages". `--provenance` and `--provenance-file` are mutually exclusive, and `--provenance-file` skips automatic generation including the trusted-publishing path                                                                                                                                                                                                                                                                                                                                                                              |
| npm Docs, [`npm audit`](https://docs.npmjs.com/cli/v11/commands/npm-audit), read 2026-10-23                                                                                                                                                               | "The `audit signatures` command will also verify the provenance attestations of downloaded packages", and `npm audit signatures --json --include-attestations` returns the DSSE envelopes, verification material and transparency-log entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GitHub Docs, [Using artifact attestations to establish provenance for builds](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds), read 2026-10-23 | For a container image the permissions are `id-token: write`, `contents: read`, `attestations: write` and `packages: write`; the subject is `subject-name` plus `subject-digest` as `sha256:HEX`, with no tag in the image name. Verification is `gh attestation verify oci://ghcr.io/ORG/IMAGE:tag -R ORG/REPO`, with `oci://` required and `docker login ghcr.io` shown before it                                                                                                                                                                                                                                                                                                                                   |

**A correction worth recording, because the work order's wording invites the
wrong test.** `npm publish --dry-run` **cannot verify provenance**. It makes no
registry call that publishes anything, so no attestation is produced, nothing
reaches the public transparency log, and `npm audit signatures` has nothing to
read back. A dry run verifies **packaging** (what files the tarball would carry,
which is what `npm pack --dry-run` is for and is worth doing for its own sake,
given #156's class of defect). **The only thing that verifies provenance
publishing is one real publish**, which is why section 7.4 is written around a
pre-release version on a non-`latest` dist-tag rather than around `--dry-run`.
That is the honest reading of "test-published to a scoped dry run": scoped and
disposable, not unpublished.

### 7.3 Container image attestations: what is verifiable now, and what is not

`.github/workflows/images.yml` already builds all three images **with an SBOM
and a provenance attestation**, writes the in-toto documents out as plain JSON,
uploads them as the `image-attestations` artifact, reads the pushed manifest back
to confirm the attestations survived the export, and fails the step on a missing
attestation. It publishes to GHCR on pushes to `main`. The `scan` job then runs
grype over those SBOMs. That half is built, asserted and green: **`scan` is
`success` on the pull request that lands this document**, which is where this
document reports it and the only place it does.

**Why no per-commit history of that job is given.** `images.yml` carries
`paths-ignore: ["**/*.md", "plan/**"]` (`.github/workflows/images.yml:57-59`),
and its own comment at `:46-50` states the consequence: a docs-only push to
`main` skips the whole workflow, so no run happens and nothing is published for
that commit. So `scan` is **absent** on some commits by design rather than
failing on them, and an absence read as a gap is a mistake this section made
twice. The job's state is meaningful on a head where it ran, and the pull
request is such a head.

**What this pass could not verify, and why, stated rather than inferred:**

- **`gh attestation verify` is not available on this host.** `gh --version` is
  `2.46.0`, and `gh attestation` is not a command in it. The subcommand requires
  a newer CLI;
- **the GHCR package list is not readable with this credential.**
  `gh api orgs/roonga/packages?package_type=container` and the user-scoped
  equivalent both answer **403, "You need at least read:packages scope"**. So
  this pass cannot name a published tag, cannot confirm whether the packages are
  public or private, and cannot run a verification even with a newer CLI;
- `gh api repos/roonga/qcms/attestations/...` answers 404 for a digest this pass
  does not have, which establishes nothing either way.

So **the GHCR attestations are built and asserted in the workflow that produces
them, and unverified from outside it.** That is a weaker claim than "verified"
and it is the one this document makes. Closing it is **one Code Owner item in
section 11.1**, and it is not a code change: it needs two things this host did
not have, a `gh` of 2.49 or newer and a token carrying `read:packages`.

### 7.4 The exact recipe for the Code Owner

Written to be applied in order. Steps 1 to 3 are the ones nothing in the
repository can do.

**Step 1: claim the scope** (#360). Create the npm organisation and claim
`@roonga`, plus the unscoped `create-qcms-app`. **Re-check availability first**:
the names were last confirmed unclaimed on 2026-07-19, and #360's body still
names the superseded `@qcms` scope, which CLAUDE.md has since moved to
`@roonga`. Enable **2FA on the publishing account**, which is SEC-11's own
requirement and is verifiable only from inside that account.

**Step 2: choose the publish identity.** Two options, and the choice changes
step 4.

- _Trusted publishing (recommended, and what npm now documents as the default
  path)._ No long-lived token in the repository. It is configured **per package**
  on npmjs.com, which means a package must exist there first, so for a
  never-published package the **first** publish uses a token and trusted
  publishing is configured afterwards. Note the deadline: a newly created trusted
  publisher configuration must complete its first successful publish **within 2
  days** or it expires. Requires npm CLI 11.5.1+ and Node 22.14.0+.
- _Granular automation token._ Scope it to publish, store it as the
  `NPM_TOKEN` repository secret, and keep `--provenance` explicit. Simpler for a
  first publish and the thing to fall back to if step 4 fails.

**Step 3: the disposable publish that is the actual verification.** Pick one
package, `@roonga/qcms-core`, and publish a pre-release version on a
non-`latest` dist-tag so nothing resolves to it by default:

```sh
# from a CI job on a GitHub-hosted runner, with permissions: { contents: read, id-token: write }
npm publish --workspace @roonga/qcms-core \
  --access public --provenance --tag next
```

Then verify, which is the step that makes it evidence rather than a green job:

```sh
npm view @roonga/qcms-core@next --json         # the version exists under the `next` tag only
npm audit signatures --json --include-attestations   # reads back the attestation bundle
```

and open `https://www.npmjs.com/package/@roonga/qcms-core` and confirm the
**"Built and signed on GitHub Actions"** provenance panel names this repository,
the workflow file and the commit. If the panel is absent, the publish succeeded
and the provenance did not, which is exactly the failure this step exists to
find before the launch gate.

**Step 4: the workflow.** If step 3 ran from a developer machine it produced no
provenance, because provenance requires a cloud CI provider. The job it needs is
small and has no third-party action in it, so it adds no dependency:

```yaml
name: release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: Pack and report only, publish nothing
        type: boolean
        default: true
permissions:
  contents: read
  id-token: write # required for provenance; without it npm cannot mint the OIDC token
jobs:
  publish:
    runs-on: ubuntu-latest # provenance requires a cloud-hosted runner
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - if: inputs.dry_run
        run: pnpm -r --filter "./packages/*" exec npm pack --dry-run
      - if: ${{ !inputs.dry_run }}
        run: pnpm changeset publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} # omit under trusted publishing
```

Four things a reviewer of that file must check. The first three are gates in this
repository rather than style preferences; the fourth is the one claim here that
nothing local can settle:

1. **`scripts/check-docker-job-guards.mjs` holds a list that is total**: every
   job in every workflow must appear in it, and every entry must name a real job.
   A new `release.yml#publish` job fails `check:all` until an entry is added
   saying which of the two guard actions it needs, which is none, and why.
2. **Action pinning** (#948, #1078). `actions/*` is the first-party carve-out and
   may stay on a tag; `pnpm/action-setup` must keep the full SHA with the release
   in a trailing comment. `scripts/check-actions-pinned.test.ts` enforces both
   directions.
3. **`--provenance` is redundant once the manifests carry
   `publishConfig.provenance`**, and harmless. Under trusted publishing it must
   not be combined with `--provenance-file`, which would skip automatic
   generation.
4. **Confirm `pnpm changeset publish` actually honours
   `publishConfig.provenance`, rather than assuming it.** The changesets CLI does
   not publish by itself: it shells out to a package manager's `publish`, so
   whether the manifest field takes effect depends on the binary it invokes and
   on how that binary reads `publishConfig`. This pass did not test it, because
   nothing is published and there is no publish to test. **The cheap insurance is
   to keep `--provenance` explicit on the publish step**, which note 3 already
   permits and which costs nothing if the field is honoured anyway. Verify on the
   disposable publish of step 3: if the npm package page shows no provenance
   panel, this is the first thing to check.

**Step 5: the container attestations.** On a host with `gh` 2.49 or newer and a
token carrying `read:packages`:

```sh
gh attestation verify oci://ghcr.io/roonga/qcms-api:<tag> -R roonga/qcms
gh attestation verify oci://ghcr.io/roonga/qcms-portal:<tag> -R roonga/qcms
gh attestation verify oci://ghcr.io/roonga/qcms-admin:<tag> -R roonga/qcms
```

`docker login ghcr.io` first if the packages are private, which they are by
default when a first push creates them.

---

## 8. Repository posture

Verified against the live GitHub configuration on **2026-10-23**, not against
the documentation of it.

**`SECURITY.md` is published and accurate**, read line by line: private
disclosure through GitHub Security Advisories with the direct reporting link, an
acknowledgement and assessment commitment with honest targets rather than an SLA
claim, a coordinated-disclosure default, a safe-harbour clause, a
supported-versions table that says pre-1.0 previews get no backports, and an
in-scope and out-of-scope statement that matches `docs/SECURITY_DESIGN.md`
section 1. **Private vulnerability reporting is enabled on the repository**
(`gh api repos/roonga/qcms/private-vulnerability-reporting` returns `true`), so
the link in it works rather than only existing.

**Two staleness corrections land with this change**, because a security policy
that cites a superseded review is the kind of defect this document exists to
catch: its pre-release notice and its closing reference now cite this document,
with the August pass named as the prior one, and its description of the design
record now says SEC-1 to SEC-17 rather than SEC-1 to SEC-13.

**The `protect-main` ruleset is active on the default branch**, read from
`gh api repos/roonga/qcms/rules/branches/main`, since
`branches/main/protection` answers 404 on this repository. It carries
`deletion`, `non_fast_forward` (no force-push to `main`),
`required_linear_history`, `pull_request` with `allowed_merge_methods: ["squash"]`
and `require_extra_approval_for_unattributed_changes: true`, and
**`required_status_checks` with exactly four contexts**:

| Required context   | Where it is produced        |
| ------------------ | --------------------------- |
| `verify (node-24)` | `.github/workflows/ci.yml`  |
| `api-e2e`          | `.github/workflows/ci.yml`  |
| `browser-e2e`      | `.github/workflows/ci.yml`  |
| `full-stack-e2e`   | `.github/workflows/e2e.yml` |

**All four are `success` on the pull request that lands this document**, and that
is the only place this document reports them. **Read them there and nowhere
else**, for a reason that is a property of the ruleset rather than a convenience:
`required_status_checks` is enforced on a pull request, so a context's state on
some commit of `main` is not what any gate consults. Earlier drafts of this
section tabulated per-commit state across four and then six base heads, and were
wrong about it twice, in both directions, because a check-run read while a run is
queued or superseded is not the run's result. **A snapshot of a moving target was
never the evidence; the pull request's own checks are.**

That matches SEC-11's "branch protection, required CI, no force-push to main".
The August pass's one observation here is closed: the required context is now
`browser-e2e` rather than the under-reporting `portal-e2e` (#493), and the
ruleset context was moved in the same coordinated step as the job rename.

**The ruleset has no bypass actors, and that took a second endpoint to
establish.** `/rules/branches/main` lists the rules that apply and **not** the
ruleset's bypass list, so this pass first recorded it as unverifiable.
`/rulesets/19714021` does report it:
`gh api repos/roonga/qcms/rulesets/19714021 --jq '.bypass_actors'` returns `[]`,
with `enforcement: active` and `target: branch`, confirmed 2026-10-24. That
agrees with the claim `CONTRIBUTING.md` makes three times, at `:372`, `:378` and
`:632` (the third as "`bypass_actors` is empty"), and it is the stronger
form: a required check with no bypass actor cannot be waived by anyone, which is
what makes "required CI" mean what SEC-11 says it means.

---

## 9. Exit criteria: state at close of review

| #   | Criterion                                              | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Matrix suite green in CI, permanently                  | **Met, and its membership is stronger than in August.** `apps/api/e2e/security/` matches the `qcms-api-e2e` project's `e2e/**/*.e2e.ts` include, and that project is what the **required** `api-e2e` context runs. So the suite is required CI rather than merely present in CI, which is what does not go stale. The case count is a measurement and moves, so it is given with where it was taken: **499 cases over five files, all passing**, measured by this pass's own `pnpm verify` **at `0ad4f61c`, whose base was `cd040e48`** (`01` 300, `02` 42, `03` 105, `04` 42, `matrix-coverage` 10). That run's `qcms-api` task was a **cache miss**, so the suite executed rather than replaying, which is the distinction issues #989 and #1029 are about. **The measurement carries forward to the tree reviewed** because **`git diff --name-only cd040e48 <the tree reviewed> -- apps/api` is empty**, which is how this is stated deliberately: an explicit end SHA here went stale on each of five rebases, so the range is written against whatever base the header names. Checked at `92262a80`: empty, and empty at every intermediate base too. **No commit between that run and the tree reviewed touched `apps/api` at all**, which is what the empty diff says and is the whole of the claim. No count of the intervening commits is given, because that count has been wrong in three successive rounds and the conclusion never depended on it. `api-e2e` is `success` **on the pull request that lands this document**, which is where section 8 says to read it and the only place this document reports it |
| 2   | All SEC rows check out; deviations documented          | **Met, with deviations documented in section 3.** Covered for **SEC-1 to SEC-17**, not the work order's SEC-1 to 13. SEC-5 is reserved and unbuilt by design; SEC-13 was not re-verified here, as in August; SEC-16 is built and **not probed by this pass**, which section 10 records as a bounded gap; SEC-17 is decided, unbuilt and mounts nothing at the default. Five deviations are named and carried rather than closed: recovery codes encrypted not hashed, HSTS from the ingress only, no admin auth-secret retirement, and #1081 and #1079 against SEC-2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | Zero open high-severity findings; review doc committed | **Met on findings. One change remains, and no severity ruling is needed.** Review document committed. **Every finding the August pass recorded is closed** (section 2), and no open issue is a high-severity finding on that pass's own scale. Two standing scanner tickets were arguably high on a literal reading of scanner output, #977 and #1054, and section 5.1 keeps both readings as the record. **The Code Owner ruled on 2026-10-24 (PR #1103) to retire them rather than rule on severity**, which removes the reading from the gate. #1107, #1108 and #1114 have merged, retiring #1054 and #1112 and leaving `pnpm audit` clean; #1108 does **not** retire #977, since three fixable highs survive it, all in npm's own bundled tree. **What remains is the npm removal that clears those three: ruled and not started, no branch and no pull request**, because the Code Owner directed that work in progress be finished and nothing new begun. **That single item is all that holds criterion 3 open**, and it needs a lane commissioned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | `SECURITY.md` published; provenance publish verified   | **Half met, as in August, and the open half is now one step shorter.** `SECURITY.md` is published, accurate and refreshed by this change, with private vulnerability reporting confirmed enabled. **The provenance half is still blocked on #360**: nothing is published, so no publish exists to attach provenance to and no account exists whose 2FA can be checked. What this change adds is the repository-side prerequisites, which were absent and are a hard requirement: `repository` and `publishConfig.provenance` on all seven publishable manifests, with a gate. **The container-image attestations are built and asserted in `images.yml` and unverified from outside it** (section 7.3). Code Owner action, section 7.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | 038's pre-flight references this review doc by date    | **Met.** `docs/features/038-launch-gate-validation.md`'s pre-flight now cites `docs/security-review-2026-10-23.md` by path and date, naming the August pass as superseded and keeping the "a later pass supersedes it by date" rule. Actually running the pre-flight is 038's work and 038 has not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**On the work order's own out-of-scope instruction, which is now carried out.**
Its out-of-scope section says "External penetration test (recommended
post-launch - issue it), bug bounty (issue)". At the 2026-10-23 sweep a search of
all issue states for `penetration`, `bug bounty` and `mTLS` returned **zero
hits** and neither issue existed. **The Code Owner filed both on 2026-10-24**:
**#1105** (commission an external penetration test after launch) and **#1106**
(decide on a bug bounty programme after launch). The instruction is discharged,
and this paragraph is left as the record of what was missing rather than deleted.
Note for anyone re-running that search: it is not a stable test, because this
document's own text and pull request body now match all three terms. Check the
two issue numbers instead. Section 11.

---

## 10. What could not be verified, and why

Stated as gaps in this document rather than as passed checks.

1. **npm provenance publishing.** Nothing is published (#360). Section 7.
2. **npm account 2FA.** There is no account to check. SEC-11 requires it and it
   is verifiable only from inside the publishing account.
3. **The GHCR image attestations, from outside the workflow that builds them.**
   `gh` on this host has no `attestation` command and the credential lacks
   `read:packages`. Section 7.3.
4. **SEC-16, repeating-group bounds.** Built by tasks 071 to 077 and covered by
   their own suites in required CI, but **no probe in the cited review set
   covers it** and this pass did not run one. The ten reviews read here are the
   environments track. A reader who needs SEC-16 probed should read the
   `AGENT-REVIEW` comments on #1038 and #1040 and the five siblings, which this
   pass did not.
5. **SEC-13 telemetry redaction**, not re-run here, the same position the August
   pass took. It rests on tasks 054 and 062's suites.
6. **SEC-17**, decided and unbuilt. Nothing to verify beyond the fact that the
   default mounts nothing, which #1061 did verify.
7. **The `EXPLAIN ANALYZE` cardinality channel's practical exploitability**
   against a real reporting consumer's identifier space. #1093 established the
   channel exists and that no answer value crosses it; nobody has measured what
   it is worth to an attacker who already holds a reporting credential.
8. **Nothing is left open here on the dependency side, and the gap this item
   used to record is worth keeping as a note on method.** It read, in turn, that
   the three `launch-editor` advisories' reachability in this repository's own
   development loop was unmeasured, and then that #1112's `zod` advisory's was.
   **Both are moot**: #1107 patched the first three and #1114 the fourth, and
   `pnpm audit` is clean on the tree reviewed. In neither case did this pass test
   exploitability; it established the paths and the declared ranges and reasoned
   from reachability. **That remains the honest limit of a dependency pass done
   this way**, and it is what to re-establish rather than re-read when the next
   advisory lands.

---

## 11. The sign-off checklist

**Two lists, because they need different people.** Section 11.1 is what stands
between this document and a sign-off, and it is deliberately mixed rather than
uniform: **most of its items are acts only the Code Owner can take**, and this
document simulates none of them. The exceptions are named rather than glossed:
**criterion 3's four changes are a lane's and the conductor's work**, three of
them already merged (#1107, #1108, #1114) and one ruled but not started;
and the bypass-actor item is already confirmed and ticked, kept visible so a
reader can see it was checked rather than assumed. An earlier draft of this
paragraph said nothing in 11.1 could be done by a development lane, which was
false for exactly those merges. Section 11.2 is ordinary lane work that needs no
decision from anyone, kept here because this pass found it and a finding that
lives only in a review document is a finding nobody actions.

### 11.1 Code Owner acts

**Criterion 3: no decision is outstanding. One change is, and it has not been
started.**

**Ruled 2026-10-24 (Code Owner, PR #1103): retire both scanner tickets rather
than rule on their severity.** That is the better answer than either reading in
section 5.1, because it removes the question from the gate instead of settling
it. **The count grew twice in two days, which is itself worth seeing**: retiring
#1054 was one pull request, retiring #977 turned out to take two once #1108's
lane measured what its digest bump does and does not clear, and the #1054 refresh
then surfaced a fourth item of its own. **Three have since merged; the one below
that is not ticked is the only one left.**

- [x] **#1107**, the `launch-editor` lockfile refresh, **merged as `5379319b`**,
      closing **#1054**. No override was needed: CONTRIBUTING's
      stale-lockfile case, because `@changesets/cli@3.0.3` declares `^2.14.1` and
      that range already admitted the patched 2.14.2.
- [x] **#1108**, the bookworm base digest bump of #969 item 3, **merged
      as `4c898409`**. **It does not retire #977 on its own**: five of
      the 2026-10-19 scan's eight fixable highs were already cleared on `main` by
      #1072's digest, which that scan predates, and three survive #1108. It is a
      reproducibility result, returning the three images to being buildable from
      the pinned `FROM` digest alone. **#977 stays open**, correctly, until the
      next item lands.
- [x] **#1114**, **merged as `541530e5`**, closing **#1112**, the
      `zod` high the #1107 refresh surfaced, and leaving **`pnpm audit` clean**.
      It was the one item a plain lockfile refresh could not close as the
      dependency stood, because `chromium-bidi@17.0.2` declared `zod: ^3.24.1`,
      and it took the **upstream** half of that choice rather than an override:
      `chromium-bidi` is now `157.0.8090-0` on `zod: ^4.6.5` and the override
      block is unchanged (section 5.1).
- [ ] **The npm removal for #977: ruled and not started.** Removing the bundled
      npm, npx and corepack from the three images' runtime stages is what clears
      the last three fixable highs, `GHSA-6j4f-fj2g-mc7p` and
      `GHSA-qhr7-859c-m2p7` against `brace-expansion@5.0.9` and
      `GHSA-rfgv-xxqx-mfg5` against `undici@6.28.0`, all of which sit in npm's own
      bundled tree where no workspace override reaches them and no application
      path uses them. **There is no branch and no pull request**: the Code Owner
      ruled the change on 2026-10-24 and then directed that work in progress be
      finished and nothing new started, so it is a decision on the record and not
      yet work. **This is the item that keeps criterion 3 open**, and it needs a
      lane to be commissioned before it can be ticked.

**Criterion 3 closes when the npm removal is done, and that is the whole of what
is left.** **Nobody is working on it**: it was ruled on 2026-10-24 and has no
branch and no pull request, because the same direction that ruled it said to
finish work in progress and start nothing new. So the honest statement of this
criterion's state is that it is **one commissioning decision away from being
closable**, not a queue of merges. Nothing in section 5.1 needs a verdict; it
stays as the record of what the readings were and why none had to be chosen.

**The acts that close criterion 4** (section 7.4 has the commands).

**Ruled 2026-10-24 (Code Owner, PR #1103): section 7.4 stays a recipe and does
not become a workflow in this change.** The Code Owner answers #360 first, the
npm organisation, the publish identity, the initial version and whether the first
publish runs from CI or locally, and a lane then builds the workflow from 7.4.
So every item in **this** list is an act only the Code Owner can take; building
the workflow is a lane's job once those answers exist, and section 11.2 holds the
other two items that are a lane's rather than the Code Owner's.

- [ ] **Create the npm organisation and claim `@roonga`** plus `create-qcms-app`,
      re-checking availability first (#360). Note that #360's body still names the
      superseded `@qcms` scope.
- [ ] **Enable 2FA on the publishing account.** SEC-11 requires it; nothing else
      can verify it.
- [ ] **Choose the publish identity**: a trusted publisher (configured per package
      on npmjs.com, first publish within 2 days of creating the configuration) or
      a granular automation token in `NPM_TOKEN`.
- [ ] **Run the disposable publish and verify it**: publish
      `@roonga/qcms-core` at a pre-release version with `--tag next`, then
      `npm audit signatures --json --include-attestations`, then confirm the
      "Built and signed on GitHub Actions" panel on the package page names this
      repository, the workflow file and the commit.
- [ ] **Answer #360's four open questions**, which is what unblocks the workflow:
      does the `@roonga` organisation exist, token or trusted publisher, what
      initial version, and does the first publish run from CI or locally. A lane
      builds `release.yml` from section 7.4 once those are answered. If the answer
      is that publishing stays manual, that needs recording against SEC-11, which
      currently says "publish only from CI on tagged releases".
- [ ] **Verify the container attestations** with `gh attestation verify` on a host
      with `gh` 2.49 or newer and a token carrying `read:packages`, for all three
      `ghcr.io/roonga/qcms-*` images.

**One confirmation, now done and recorded here rather than left as a task.**

- [x] **`protect-main` has no bypass actors.** Confirmed on 2026-10-24:
      `gh api repos/roonga/qcms/rulesets/19714021 --jq '.bypass_actors'` returns
      `[]`, with `enforcement: active` and `target: branch`. Section 8 recorded
      this as the one thing it could not verify, because the
      `/rules/branches/main` endpoint does not report bypass actors; the
      `/rulesets/<id>` endpoint does, and it agrees with the claim
      `CONTRIBUTING.md` makes three times. Nothing outstanding.

**The gate itself.**

- [ ] **Sign off the 040 security review**, or do not. This document asserts
      nothing about that outcome.

### 11.2 Lane follow-ups, needing no decision

**Neither of these is a Code Owner act and neither gates the sign-off.** Both are
small, same-area changes that any lane can make, and both are documentation
accuracy rather than a control defect. They are listed because this pass found
them and a finding that lives only in a review document is a finding nobody
actions.

- [ ] **Close the last residue in the credential-free statement path**
      (section 4.3), either by wrapping `regrant.ts`'s `exec.transaction` or by
      narrowing the four "every database call" sentences to "every call this
      module issues". #1101 closed the three reads; drizzle's own `begin` is what
      is left, and it carries no credential.
- [ ] **Add the sentence `docs/reporting-view.md` was asked for**, saying plan
      cardinalities are outside what `security_barrier` covers (#1093,
      section 4.2).

---

## 12. Sign-off

**Unsigned.** The 040 security review is a Code Owner gate. This document is the
evidence for that gate and asserts nothing about its outcome.
