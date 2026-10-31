HANDOFF: AWAITING-HUMAN review of PR #1199

Task 083, actions on every screen (`docs/features/083-agent-actions-every-screen.md`). **D0 is
complete on this head and ready for review.** D3 to D9 are next; D1 and D2 come after PR #1200
(environment phase 5), which replaces the publish and release screens and deletes
`publishFormAction` and `publishAndReleaseAction`.

## What D0 ships

The token, migration 0007 and `control.agent_actions`, the four `ActionKindDef` descriptors and
the frozen registry, the grant filter, the propose tools and their advertised schemas, the
provenance check and its mounted middleware, the audit helper in all four handlers, the `action`
and `plan` SSE events, the `action-result` turn variant, `SYSTEM_PROMPT_VERSION` 7, the nine
fake-provider action scripts, the card and plan-card shell with its fold, copy, runner and
components, and the step-actions bridge. The earlier `HANDOFF.md` entries in `git log` list each
piece in detail.

## This lane

- **A form-scoped screen offers the whole form subtree's action kinds** (Code Owner, 2026-10-31),
  recorded in the work order's D0 section. `offerableActionKinds` in `screens.ts` is the rule, the
  grant filter takes the screen and applies it, and the propose-schema builder follows from the
  offered list. The kinds stay filtered on (kind, environment) by the caller's grants, every step
  still runs its own screen's exported server action under its own route's checks, and a screen
  outside a form subtree keeps its own kinds. `plan-three` (publish, release, mint) is now one
  card from a form screen, asserted in `actions.integration.test.ts`.
- **`ActionStepResultBody`'s `result` is a closed object**, its members the union of every
  registered kind's `resultAllowlist`, so the request-body walk reads a closed object rather than
  an effects wrapper. The per-kind narrowing moved off the schema into the route:
  `actionResultRefusal` runs on both assist handlers and answers `400
  ACTION_RESULT_NOT_ALLOWED`.
- **The read-tool walk** asserts `AGENT_READ_TOOL_NAMES`, a new registry split beside
  `AGENT_PROPOSE_TOOL_NAMES`, rather than every registered name. The propose tools put a card up
  for the user to confirm, so a read walk never executes one.
- **The `control` SELECT list** in `03-db-least-privilege.e2e.ts` now names both audits through
  the file's own `AUDIT_TABLES`, matching `04-db-restore-regrant.e2e.ts`'s shape. The grant set
  the work order mandates is identical to `control.access_audit`'s, so this is the intended
  assertion.
- **`check-dead-i18n-keys.test.ts`'s exemption tripwire** now pins the eight action-card keys
  with their reasons instead of asserting the set is empty. The keys are named by the API's
  descriptors, which the scan cannot read, and a ninth entry still fails the test.

## What is a D0 card mechanism and what wires it for real

- The **erasure typed-confirmation gate** and **Pending approval** are card mechanisms here,
  tested with synthetic steps. D4's erasure kind supplies the first real typed confirmation, and
  D5's `prod` endpoint mechanism is what returns Pending approval for real.
- The **proposal marker** component and its rules ship here; placing it on each screen's heading
  row belongs to each screen group from D3 onwards. D3 (links) is the first group whose kinds are
  runnable today.
- The **Playwright paths and axe over the card's eight states** (criterion 11) are per screen
  group and belong with D3 onwards.

## Constraints the next lane needs

- **A step with more than one reference fails closed** in `provenance.ts` and is refused at
  `propose_plan` (Code Owner, 2026-10-31). Widen both halves together.
- The static conditional read-only sentence stays in the system prompt, byte-identical for
  caching (Code Owner, 2026-10-31).
- `link.mint`'s descriptor takes its environment from the switcher while its route policy reads
  it from the body. The admin posts the switcher's environment, so the two agree; left as is by
  the Code Owner's open question to the reviewer.
- `step-actions.ts` deliberately wires only `link.mint` and `link.revoke`, and says so. The
  `form.publish` and `form.release` descriptors stay because D0's own criteria need a kind whose
  environment comes from its arguments.
- `control.agent_actions.detail` is text, so a reference's recorded value is compared as text.
- **Issue #1190** (read-tool filtering) stays separate; not this task.
- The records criterion 14 names (ADR-25's status, SEC-17's verified-by,
  `docs/agent-authoring.md` section 4, `docs/SECURITY_DESIGN.md` section 8, 038's header, the
  ledger rows, the work-order removals) are untouched and belong to the final PR.

## Gates on this head

- Cheap gates: `pnpm check:all` green, including `check:comments`, `check:templates` and
  `check:dead-i18n-keys`.
- `pnpm verify`: exit 0.
- `pnpm exec turbo run test --force`: 20 of 20 tasks, 0 cached, green.
- `QCMS_PORT_SEAT=7 pnpm up:e2e`: 19 passed.
- `QCMS_PORT_SEAT=7 QCMS_HARNESS_BUILD=1 pnpm verify:browser:detached`: 539 passed, exit 0.
- Two further forced runs failed only `apps/admin/app/(shell)/form-read-states.test.tsx`, which
  times out at its 5s cap under full-repo parallel load. It takes 1.8s alone, the whole admin
  package suite passes alone (163 files, 2184 tests), and the branch changes nothing in
  `apps/admin`. This is issue #604's shape and worth raising on its own.
