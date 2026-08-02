# features/ - Ordered task files

Each file is a self-contained work order for one agent session (or one focused human session). Execute in numeric order, subject to the ordering exceptions below; the **Depends on** header lists hard prerequisites. Files never expand their own scope - discoveries become issues.

## Ordering exceptions (single source of truth)

A task's **Depends on** header already expresses every "runs *after* X" constraint, and selection honors it mechanically. This table carries only what `Depends on` cannot express: "runs *before* Y" and "never gates Y". `/next-task` reads this table; do not keep a second copy anywhere else.

| Task | Constraint | Why |
|---|---|---|
| 040 | before 038 | security review and hardening precede the external-tester launch gate |
| 041 | never gates 038 | agent-assisted authoring is flag-gated and off the launch gate (ADR-25) |
| 056 | before 036 | auth consolidates into the API before compose provisions containers, so compose never provisions an admin database credential it would immediately have to take away |

Exceptions retire when their task lands: 042, 043, 044, 045 and 055 all carried one and are now `done`.

**Self-containedness convention:** a task is self-contained *given the repo's `docs/` set* - task files carry the what/why/done, and point at the specific doc sections that carry contracts (schemas, semantics, layouts) so those live in one place and can't drift. 001 bootstraps the docs into the repo, so every later session finds its references locally. If a referenced section is missing or contradicts the task, that's a blocking issue - stop and surface it, don't improvise. Tasks needing anything *outside* the repo (e.g. the `a2-react-aria` repo in 011/028) declare it in an **External input required** header.

## Agent execution protocol

(Normative long form: `AGENTIC_DEVELOPMENT.md` §3.)

1. Read `PROJECT_INSTRUCTIONS.md` (rules R1–R8 + amendments), then the task file, then the **References** it lists. Check the **progress ledger below** and `git log` - trust the repo over memory.
2. Do only what the task's Deliverables and Exit criteria require. **Out of scope** sections are binding. Blocked on a genuine decision → stop and ask; never choose silently.
3. Tests ship with the code; docs named in the task are updated in the same change.
4. A task is done only when every exit criterion passes and **`pnpm verify`** is green at the repo root, plus **`pnpm verify:browser`** when the task touches `apps/portal`, `apps/admin`, or `@qcms/ui`. What each gate covers and how it maps to CI: `CONTRIBUTING.md` (the merge gate section owns that mapping). **Update the ledger status in the same PR.**
5. **Green or clean:** if a session can't finish, either revert to green or park on the task branch with a `HANDOFF.md` (state, next step, what's red). Never merge red; never leave main broken.
6. Branch `feat/NNN-slug`; task number in commit messages; PR description is the exit-criteria checklist, checked off.
7. **Review before merge:** a human, or a second agent session given only the task file + diff, verifies exit criteria and rule compliance (R1–R8, cut-line, SEC controls). The reviewer verifies; it never extends the work.
8. Record anything tempting-but-out-of-scope as a GitHub issue (label `phase-4` if it's beyond the cut-line).

## Index and progress ledger

Status values: `todo` · `blocked (issue #)` · `done (PR #)`. A row goes `todo` -> `done (PR #N)` exactly once, inside the completing PR - this table is the cross-session source of truth for plan state.

**`in-progress` is retired as a claim.** Since 2026-07-31 the **pushed task branch is the claim lock**: a live `origin/feat/NNN-*` branch claims task NNN (the `protect-main` ruleset blocks the direct ledger commit the old `in-progress` claim needed). Never write the status to claim work, and never read it as evidence that work is live - check `git ls-remote --heads origin 'feat/*'` instead. One legacy row survives: **030**, which is genuinely part-landed and parked on its human gate (the manual screen-reader pass); it gets its final status in its completing PR.

| # | Task | Stage | Status |
|---|---|---|---|
| 001 | Repository bootstrap | 0 | done |
| 002 | Core IDs, LocalizedText, canonical AnswerValue | 1 | done |
| 003 | Question-type definitions | 1 | done |
| 004 | FormDefinition and typed publish errors | 1 | done |
| 005 | Rules DSL schemas and dependency graph | 2 | done |
| 006 | Rules evaluator (forward pass) | 2 | done |
| 007 | Evaluator test corpus | 2 | done |
| 008 | compileDraft publish aggregate | 3 | done |
| 009 | Answer validation and submission lock | 3 | done |
| 010 | Secure-link tokens (core) | 3 | done |
| 011 | A2UI compiler | 4 | done |
| 012 | A2UI golden corpus and agent seam | 4 | done |
| 013 | DB schema, migrations, test harness | 5 | done |
| 014 | Query helpers | 5 | done |
| 015 | Reporting view and retention sweep | 5 | done |
| 016 | Erasure (ADR-17) | 5 | done |
| 017 | API composition root | 6 | done |
| 018 | start-session slice | 6 | done |
| 019 | get-step and submit-answer slices | 6 | done |
| 020 | submit slice (lock + outbox) | 6 | done |
| 021 | Question authoring slices | 6 | done |
| 022 | Form authoring and publish slices | 6 | done |
| 023 | Response listing, export, erasure slices | 6 | done |
| 024 | Secure-link minting and webhook config slices | 6 | done |
| 025 | Webhook deliverer worker | 6 | done |
| 026 | Abuse controls | 6 | done |
| 027 | API end-to-end suite | 6 | done |
| 028 | A2UI renderer (`packages/ui`) | 7 | done |
| 029 | Portal app (SSR + BFF) | 7 | done (design signed off by the Code Owner 2026-07-22; no-JS-submission clause of exit-2 waived → task 044/#17) |
| 030 | Portal accessibility pass | 7 | in-progress (automated portion landed 2026-07-22; 045 landed so the full flow is navigable; manual NVDA/VoiceOver pass DEFERRED by the Code Owner 2026-08-01 until the end-to-end chain 033-035 is complete, then run as a human gate - not selectable before then) |
| 031 | Admin shell and 2FA auth | 8a | done (PR #205; screenshot gate signed by the Code Owner 2026-07-31; areas 032-035 land as placeholders) |
| 032 | Admin question library | 8a | done (PR #228; #218 type column and the topbar rebuild ridden along; "Updated" column dropped as an accepted deviation) |
| 033 | Admin form builder and condition editor | 8a | done (PR #245; screenshot gate signed by the Code Owner 2026-08-01; CodeMirror adopted as the ADR-22 exception the signed wireframe names; the ADR-31 same-step warning in the deliverables does not exist upstream, filed as #246 and corrected in the task file per the Code Owner's option (b) ruling) |
| 034 | Admin publish, preview, versions, secure links | 8a | done (PR #274; preview seam per the 2026-08-02 amendment (#271); "core evaluator client-side" replaced by the 033 precedent - the API returns compiled documents plus the forward pass's visible set and `documentForVisible` moved into `@qcms/ui` so preview and portal share one projection; admin timestamps render UTC with the zone named, accepted by the Code Owner with operator-local display queued as an enhancement) |
| 035 | Admin responses, erasure, webhook operations | 8a | todo |
| 041 | Agent-assisted form building (flag-gated; off the launch gate - ADR-25) | 8a | todo |
| 042 | UI wireframes (lo-fi pass; runs after 027, before 029/031–035) | 7 | done (signed off 2026-07-21) |
| 043 | Rename example domain to vehicle insurance (runs after 029, before 030/031–035) | 7 | done (one-time golden re-baseline, ADR-18 amended 2026-07-22; closes #16) |
| 044 | No-JS submission (progressive enhancement; after 029, off the launch gate - issue #17) | 7 | done (closed for boolean/choice/text/date; numeric no-JS deferred - upstream RAC limit, #18) |
| 045 | Portal step navigation: explicit cursor (Continue/Back/Submit); full-flow kitchen-sink e2e x3 viewports with independent DB + container-log verification (fixes review M/N/G; ADR-28) | 7 | done (explicit cursor ADR-28; fixes M/N/G; 3-viewport full-stack e2e + independent DB verify + fixture-content guard) |
| 046 | Dev container as the canonical dev environment (Ubuntu 24.04; bypassPermissions loop; ADR-29) - off the launch gate; dispatch manually via `/task 046` after 045, not auto-selected | 7 | done (PR #46; criterion 4 amended by the Code Owner to the scoped bypassPermissions probe that was verified; amd64 only, arm64 expected-supported but untested) |
| 047 | Portal theming: managed themes + respondent controls (mode/font/density) + declarative font registry + 4-group token contract (color/type/spacing/radius), ADR-30 - launch tier (admin theme editor split out to 049 per the 2026-07-25 amendment) | 7 | done (decomposed 2026-07-27 into 051 -> 052 -> 053; all three landed - PR #190, #194, #198) |
| 051 | Theming A: 4-group token contract + predefined themes (L/D) + HC mode layer + per-deployment selection via config (047 EC 1-2) | 7 | done (PR #190; 4 themes x L/D + one `.hc` layer, contrast computed from the shipped CSS across all 12 combinations, vendored controls themed from a non-vendored unlayered stylesheet so ADR-22 holds) |
| 052 | Theming B: declarative self-hosted font registry + curation config + tabular figures (047 EC 4 + font floors) | 7 | done (PR #194; 22 families self-hosted as committed woff2 (711 KB, no build-time fetch), `fonts.css` generated from the manifest and drift-guarded, zero off-origin requests proven live, tabular figures token-driven) |
| 053 | Theming C: respondent mode/font/density controls + persistence + SSR no-flash + brand mark from config (047 EC 3, 5-7; folds #25; UI screenshot gate) | 7 | done (PR #198; server-side cookie persistence so the root class is in the first byte, no-flash proven by first-frame sampling, 2.5.8 measured at Compact, floors held over 69 font x density combinations, brand mark from config; closes #25) |
| 048 | Author-supplied validation messages (ADR-32; folds #22) + boolean yes/no label overrides (ADR-36): per-question LocalizedText with edit-level default fallback | 8a | todo (after 032) |
| 049 | Admin theme editor: customize tokens + save named custom theme (ADR-30 amended 2026-07-25 to launch tier; folds #26) | 8a | todo (after 031 + 047) |
| 057 | Option grid: inline-editable table for choice options (Code Owner direction 2026-08-01; card `ds-option-grid.html` frozen before dispatch; UI screenshot gate) | 8a | todo (after 048) |
| 050 | Answer retraction: tombstone append resolved to unanswered by latestAnswers (ADR-33; folds #95) | 7 | done (PR #97; kernel unchanged per the accepted ADR-33 divergence; landed before PR #90, which rebases over it) |
| 058 | Preview theme island: respondent theme/mode switch scoped to the admin preview (Code Owner direction 2026-08-01; mounts on the preview seam 034 builds, so it follows 034 rather than gating it; UI screenshot gate) | 8a | todo (after 034; enrichment tier, so it waits behind 035 per the Code Owner's 2026-08-01 flow-first aim) |
| 054 | Observability: OTel tracing baseline (portal -> API -> pg via traceparent) + pino trace-correlated logs + SEC-13 redaction allowlist (ADR-34) | 8b | done (PR #181; traced e2e via in-test OTLP receiver; SEC-13 redaction; whole Playwright suite runs traced) |
| 055 | QCMS app theme application: Cobalt tokens + Lexend + sharp corners + mode control (after 031, before 032; UI screenshot gate) | 8a | done (PR #214; screenshot gate signed by the Code Owner 2026-07-31) |
| 056 | Auth consolidation: better-auth moves into the API, admin loses its DB handle (ADR-35 amendment 2026-07-31; supersedes #211; after 035, before 036) | 8b | todo |
| 036 | Production images, compose, ops docs | 8b | todo |
| 037 | create-qcms-app CLI | 8b | todo |
| 040 | Security review and hardening (runs after 036, before 038) | 8b | todo |
| 038 | Launch-gate validation | 8b | todo |
| 039 | Phase-4 backlog recording | 9 | todo |

Note: 040 was added after initial numbering; it executes between 036/037 and 038. Security controls are designed in `SECURITY_DESIGN.md` (SEC-1…13) and largely delivered inside feature tasks - 040 verifies them as a system.
