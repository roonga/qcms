# Work-order sequence: workspace access and the agent builder

Status: proposal for tasks 084 to 121, reserved in `docs/features/README.md`. The rules are in `docs/WORKSPACE_ACCESS.md` (access) and `plan/agent-builder-decisions.md` (builder); this file orders the work and maps criteria to tasks. Where it differs from `plan/workspace-access-implementation.md`, this file holds.

## Legend

Gates:

| Gate | Command                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V    | `pnpm verify`                                                                                                                                                                                                   |
| D    | `pnpm exec turbo run test --force`, confirmed executed, not cached                                                                                                                                              |
| B    | `QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached`, then `pnpm verify:browser:wait <dir>` in slices until it stops exiting 75; never on the same checkout as D at the same time                                |
| E    | `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`; never concurrently with B on one seat                                                                                                                                       |
| M    | `apps/api/e2e/security/matrix-coverage.e2e.ts` and `apps/api/e2e/security/01-authorization-matrix.e2e.ts`, updated for every route the task adds or changes and run green (they run under E's stack or D's run) |

- Review: F Fable (security-sensitive or hard), O Opus, S Sonnet. Every task gets a Sonnet delta re-review after a fix or rebase.
- DG: design gate. The task is not dispatched until its screens are on the design canvas and the Code Owner has seen them.
- Every task: template mirrors via `packages/create-qcms-app/sync-templates.mjs`, `pnpm openapi:generate` when routes change, the dead-key check, logs under `node scripts/agent-scratch.mjs <name>`, and a PR listing the suites run and skipped. Tests ship in the task that owns the criterion.

## Combined task table

| Task | Title                                        | Depends on                  | Review | Gates         | DG           | Migration |
| ---- | -------------------------------------------- | --------------------------- | ------ | ------------- | ------------ | --------- |
| 084  | Workspace quick wins and list scope (Q1)     | spec                        | O      | V, D, M       | no           | no        |
| 085  | Access roles and group shape                 | spec                        | F      | V, D, B, E, M | no           | 1st       |
| 086  | Site administrator default, starter groups   | 085                         | F      | V, D, E       | no           | 2nd       |
| 087  | Outbound email                               | spec, mail ruling           | O      | V, D, E       | no           | no        |
| 088  | Account state and site audit                 | 086; after 108 in the queue | F      | V, D, E       | no           | 4th       |
| 089  | Membership guards, Workspace administrators  | 085, 088                    | F      | V, D, E, M    | no           | no        |
| 090  | Account creation and claim                   | 087, 088, 089               | F      | V, D, B, E, M | no           | 5th       |
| 091  | Account disable, reactivation, reset         | 089, 090                    | F      | V, D, E       | no           | no        |
| 092  | Site administrators, step-up, approvals      | 088, 091                    | F      | V, D, E, M    | no           | 6th       |
| 093  | Second approval adjustments                  | 085, 089, 092               | F      | V, D, E       | no           | no        |
| 094  | Single Publish step                          | 085                         | F      | V, D, B, E    | batch 6      | no        |
| 095  | Move form and shared question library        | 085, 089, 092, 093, 097     | F      | V, D, B, M    | batch 6      | no        |
| 096  | Agent access parity audit, builder kinds too | 089, 093, 094, 111, 112     | F      | V, D, B       | no           | no        |
| 097  | Admin access patterns                        | 104                         | O      | V, B          | batch 2      | no        |
| 098  | Admin Members and Access groups              | 089, 091, 097               | O      | V, B          | batch 3      | no        |
| 099  | Admin Settings, Audit, Archive               | 084, 093, 097               | O      | V, B          | batch 3      | no        |
| 100  | Admin Accounts                               | 090, 091, 092, 097          | O      | V, B, E       | batch 4      | no        |
| 101  | Admin Site administrators, requests          | 086, 092, 099, 100          | O      | V, B, E       | batch 4      | no        |
| 102  | Admin account menu                           | 090, 097                    | O      | V, B          | batch 5      | no        |
| 103  | Admin forms-area states and phone widths     | 093, 094, 097 to 102        | O      | V, B          | batches 6, 7 | no        |
| 104  | Access vocabulary sweep                      | 085                         | S      | V, B          | batch 1      | no        |
| 105  | Access docs and acceptance                   | 084 to 104                  | O      | V, D, B, E, M | no           | no        |
| 106  | W1 and S1: decision bundle and design system | spec                        | F      | V             | no           | no        |
| 107  | A1: appearance module                        | 106                         | O      | V, B          | no           | no        |
| 108  | D1 and D2: appearance schema, themes table   | 107, 086 merged             | O      | V, D, E       | no           | 3rd       |
| 109  | A2 and A3: draft appearance, themes, lock    | 108, 085                    | F      | V, D, E, M    | no           | no        |
| 110  | A4: derive route, `BrandFetcher`, SEC-18     | 107, 109                    | F      | V, D, E, M    | no           | no        |
| 111  | A6 and G1: edit ops, Undo, route kind, audit | 106, 085, 088               | F      | V, D, M       | no           | no        |
| 112  | G3 and G4a: builder tools, open-wizard tool  | 111, 094                    | F      | V, D          | no           | no        |
| 113  | U1: shell, routes, `returnTo`, store         | 106, 085, 094               | O      | V, B          | yes          | no        |
| 114  | U2 and U3: preview and inspect               | 113, 111, 109               | O      | V, B          | yes          | no        |
| 115  | U7: create card, card-less edits, Undo, diff | 113, 112                    | O      | V, B          | yes          | no        |
| 116  | U4 and U6: appearance drawer, themes, lock   | 109, 099, 113, 114          | O      | V, B          | yes          | no        |
| 117  | G2, U5 and G4b: theme kinds, derive flow     | 110, 116, 112               | O      | V, D, B       | yes          | no        |
| 118  | P1: portal per-form appearance, CSP          | 109                         | O      | V, B, E       | yes          | no        |
| 119  | A5 and P2: steps list, progress modes        | 108                         | O      | V, D, B, E    | yes          | no        |
| 120  | P3 and P4: respondent menu, text size        | 118                         | O      | V, B          | yes          | no        |
| 121  | S2: docs, cross-flow e2e, sentinel, closure  | 106 to 120                  | O      | V, D, B, E, M | no           | no        |

- "spec" is `docs/WORKSPACE_ACCESS.md` on `main`. 106 also needs the theme rows of that spec (section 3), which this branch adds.
- Each of 085, 086, 089 and 094 fixes the agent kinds on the routes it changes; 096 audits every kind afterwards, the builder's included.

## Parallel groups

A group starts once every dependency in the groups before it has merged. Within a group, tasks run in parallel, each in its own worktree and `QCMS_PORT_SEAT`, subject to the hot-file rule.

| Group | Tasks              | Note                                                                    |
| ----- | ------------------ | ----------------------------------------------------------------------- |
| A     | 084, 085, 087, 106 | Independent early starters; 085 alone on `policy.ts`; 087 waits on mail |
| B     | 086, 094, 104, 107 | 094 and 104 behind their design batches                                 |
| C     | 097, 108, 113      | 108 is the third migration                                              |
| D     | 088, 109, 119      | 088 merges after 108                                                    |
| E     | 089, 110, 111, 118 |                                                                         |
| F     | 090, 112, 114, 120 |                                                                         |
| G     | 091, 102, 115      |                                                                         |
| H     | 092, 098           | 092 is the last migration                                               |
| I     | 093, 100           |                                                                         |
| J     | 095, 096, 099      |                                                                         |
| K     | 101, 116           |                                                                         |
| L     | 103, 117           |                                                                         |
| M     | 105, 121           | Closure                                                                 |

- Critical path (access): 085, 086, 108 (queue), 088, 089, 090, 091, 092, 093, 099, 101, 103, 105.
- Critical path (builder): 106, 107, 108, 109, 110, 116 (after 099), 117, 121.
- Design batches 3 and 4 should be seen before 089 merges, so the UI tail stays off the path.

## Hot files: one open PR at a time

| File or area                                              | Tasks                                      |
| --------------------------------------------------------- | ------------------------------------------ |
| `membership/policy.ts`, `membership/route-policy.ts`      | 085 alone; then one open PR at a time      |
| `packages/db/migrations/` and `meta/` snapshots           | the migration queue below                  |
| `apps/admin/lib/i18n/en.ts`                               | every UI task; one UI PR merges at a time  |
| `apps/api/src/features/agent/actions/`, `grant-filter.ts` | 085, 086, 089, 094, 096, 111, 112, 117     |
| `agent/system-prompt.ts`, `agent/fake-model.ts`           | 112, 117                                   |
| `control.access_audit` kinds CHECK                        | 088, 108 (migration queue order)           |
| Draft PUT handler                                         | 109, 111                                   |
| `components/membership/workspace-settings-panel.tsx`      | 099, then 116                              |
| `lib/shell/modes.ts`, `components/admin-nav.tsx`          | 095, 100, 101, 113                         |
| Serve-step and portal page carrier                        | 109, 118, 119, 120                         |
| `docs/openapi/admin.json`                                 | every route task; the later PR regenerates |

- The later PR regenerates OpenAPI, `meta/` snapshots and template mirrors, and re-runs every gate whose inputs changed.
- Hard stop when a branch is behind `main`.

## Migration queue

Merge order is fixed: **085, 086, 108, 088, 090, 092**. The migrations on `main` end at `0007`, so the planned numbers are `0008` to `0013` in that order. Any other migration that lands first shifts them; each task numbers its migration at rebase time and keeps the order.

## Interim behaviour between tasks

Where a later task builds a guard, the earlier task states what happens meanwhile.

| Window     | Act                                                   | Interim                                                                                                                                     |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 085 to 095 | Move form                                             | Needs Edit forms in both workspaces and a Workspace administrator of the source; refused outright while second approval is on in the source |
| 085 to 093 | Self-grant of a response role with second approval on | Refused outright, as built                                                                                                                  |
| 085 to 093 | Turning second approval off                           | Applies at once for an administrator, audited, as built (not a refusal)                                                                     |
| 086 to 088 | Unclaimed first Workspace administrator               | Cannot arise: no unclaimed account exists before 090; 088 adds the refusal                                                                  |
| 091 to 092 | Disabling a Site administrator                        | Refused outright                                                                                                                            |
| 094 to 093 | Prod-only site draft publish with second approval on  | Refused outright, if 094 lands first                                                                                                        |
| 108 to 109 | Appearance on a draft                                 | Column exists; no route writes it                                                                                                           |
| 109 to 110 | Theme derive                                          | Absent; themes are saved by hand only                                                                                                       |

## Criteria to tasks

Every criterion of `docs/WORKSPACE_ACCESS.md` section 14 is owned by exactly one task.

| Task | Criteria                                                   |
| ---- | ---------------------------------------------------------- |
| 084  | 26, 97, 98                                                 |
| 085  | 2, 3, 4, 6, 9, 10, 11, 12, 13, 14, 17, 19, 24, 107, 108    |
| 086  | 20, 75, 92, 94, 95, 110                                    |
| 088  | 66, 67, 93, 112, 113                                       |
| 089  | 21, 23, 25, 86, 87, 88, 89                                 |
| 090  | 50, 51, 52, 53, 54, 55, 56, 57                             |
| 091  | 58, 59, 60, 61, 62, 63, 64, 65, 68, 69, 70, 71, 72, 73, 74 |
| 092  | 22, 76, 77, 78, 79, 80, 81, 82, 83, 84                     |
| 093  | 27 to 44, 46, 47, 49, 116                                  |
| 094  | 5, 7, 8, 18                                                |
| 095  | 16, 48, 99, 100, 101, 102, 103, 104, 105, 106, 109         |
| 096  | 90, 91                                                     |
| 098  | 15, 96                                                     |
| 101  | 45                                                         |
| 103  | 115                                                        |
| 105  | 1, 85, 111, 114                                            |
| 109  | 118, 120, 121, 122                                         |
| 110  | 119                                                        |
| 121  | 117, 123                                                   |

- 087, 097, 099, 100, 102 and 104 own no spec criterion; their exit criteria are in their work orders.
- 106 to 108 and 111 to 120 own no access criterion; their criteria come from `plan/agent-builder-decisions.md` (Required tests) and are mapped in their own work orders.
- 117 and 123 need appearance (108, 109) and either 093 or 095, so they sit with 121.

## Open Code Owner rulings

All recommendations are proposed, not ruled.

| Ruling                                    | Recommendation                                                                                              | Blocks        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| Stage and dispatch order for 084 to 121   | Stage 9, "Phase 4; does not gate launch"; dispatch ahead of 038 by explicit direction, as for 064 to 070    | all dispatch  |
| Portal tasks 118 to 120 in this programme | Yes, at least 118                                                                                           | 118 to 120    |
| Who sets the workspace appearance lock    | Workspace administrator and Site administrator; no second approval; one `setting` audit row                 | 109, 116      |
| Move form and appearance                  | Appearance travels by value; a destination lock refuses later edits only; the preview says so               | 095, 121      |
| Agent re-check wording (F4)               | "Rechecked on every draft edit request and at Confirm", since draft edits carry no card (agent-builder Q14) | 096, 111      |
| Quick fix Q1 (workspace list)             | Folded into 084                                                                                             | 084           |
| Mail dependency                           | `nodemailer` over SMTP, `QCMS_SMTP_*`, per `CONTRIBUTING.md` thresholds                                     | 087, 090, 091 |
