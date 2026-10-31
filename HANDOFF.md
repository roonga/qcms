HANDOFF: INTERRUPTED

Task 083, actions on every screen (`docs/features/083-agent-actions-every-screen.md`). D0's
server side, its SEC-17 tests against Postgres, its nine fake-provider scripts and the admin
card shell are on the branch and green on the cheap gates. **The heavy gates have not run on
this head**, and that is the only thing between here and D0 complete. D1 to D9 are not
started.

## Done on this head

### Earlier lanes (unchanged)

The token (`proposal-token.ts`), migration 0007 and `control.agent_actions` with its grant
assertions, the four `ActionKindDef` descriptors and the frozen registry, the grant filter,
the propose tools and their advertised schemas, the pure provenance check, the mounted
provenance middleware, the audit helper in all four handlers, the `action` and `plan` SSE
events, the `action-result` turn variant, and `SYSTEM_PROMPT_VERSION` 7. The previous
`HANDOFF.md` in `git log` lists them in detail.

### This lane

- **`provenance.integration.test.ts`** (15 tests, Postgres): criterion 2's equivalence in
  both directions (an allowed act stays allowed, a refused act keeps the route's own code,
  and only the token writes a row); the replay refused with `AGENT_PROPOSAL_ORDER` minting
  nothing, plus the unique constraint rolling a step's own transaction back; `plan-two-envs`
  verified step by step with step 1 rewritten to `test` refused; `plan-three` end to end over
  the publish, release and mint routes with the reference refused at a value step 0 did not
  record and accepted at the one it did; `plan-fails-at-2` stopping with exactly one row and
  step 2 never admitted; the row present or absent per transaction outcome; and criterion
  10's run that crosses `exp`, the `AGENT_PROPOSAL_WINDOW` refusal past ten minutes and the
  stale step 0.
- **`provenance-mount.ts` now reads `deps.clock`** rather than `new Date()`. The handlers
  stamp `confirmed-at` from that clock, so two clocks put the run window and the rows it is
  measured from on different time; it is also what makes criterion 10 testable.
- **`actions/registry.test.ts`** (9 tests): the registry's invariants and criterion 8's
  per-kind result allowlist, including that no allowlisted field name carries a credential,
  bytes or content, and that every referenceable field is allowlisted.
- **`schema.ts` enforces the allowlist server side.** An `action-result` step whose `result`
  names a field outside its kind's list, or whose kind is outside the registry, is refused.
  `schema.test.ts` (8 tests).
- **`PlanStep.resultAllowlist`** travels with each step, so the card filters its report
  against the descriptor rather than a second copy of the list.
- **The nine action scripts** in `fake-model.ts` (`plan-three`, `plan-fails-at-2`,
  `plan-two-envs`, `plan-pending-at-1`, `two-proposals`, `plan-26-steps`, `unknown-tool`,
  `injection-follow`, `read-only-user`), each reading the form, version and link it names
  out of the screen's own facts block. **`actions.integration.test.ts`** (8 tests) drives
  them at the API level: the plan's steps and per-step environments, both caps, the refused
  unregistered name, a `forms.viewer` offered neither propose tool, and the injected
  instruction reaching the card with its true arguments while nothing runs.
- **The admin card shell**: `lib/forms/assist-stream.ts` parses the `action` and `plan`
  events; `lib/agent/plan-state.ts` is the card's fold (step and card states, the chips-only-
  once-running rule, Confirm, Cancel, Stop, expiry, the heading chip, the result line, the
  live line and the allowlist-filtered `action-result` turn); `lib/agent/card-copy.ts` writes
  every title, argument label and consequence sentence from the kind and the catalog;
  `lib/agent/runner.ts` is the client-driven sequential runner; `components/agent/
action-card.tsx` and `proposal-marker.tsx` render them; the `agent.card.*` and
  `agent.marker.*` catalog strings are in `lib/i18n/en.ts` and the CSS in `app/globals.css`.
  Tests: `plan-state.test.ts` (16), `runner.test.ts` (10), `action-card.test.tsx` (22, the
  four card rules, the step states, focus, the live region, Escape and the marker).
- **The trailing `{ agentProposal, step }` argument** is on `mintLinksAction` and
  `revokeLinkAction`, forwarded as the two headers by `lib/server/agent-proposal.ts` through
  `lib/server/links.ts`. `components/agent/step-actions.ts` is the kind-to-server-action
  bridge the runner calls, and `assistant-conversation.tsx` renders the card as the last
  segment of the turn that proposed it and appends the settled `action-result` turn.

## Next, in order

1. **The gates, on this head.** None of the heavy ones has run here:
   - `pnpm verify`;
   - `pnpm exec turbo run test --force`, confirmed 0 cached, because migration 0007 lands
     on this branch;
   - `QCMS_PORT_SEAT=7 pnpm up:e2e`;
   - `QCMS_PORT_SEAT=7 QCMS_HARNESS_BUILD=1 pnpm verify:browser:detached` plus
     `pnpm verify:browser:wait <dir>` slices, in sequence with the forced run and never
     concurrently (issue #863).
     The cheap gates **are** green here: `check:comments`, `check:templates`,
     `check:dead-i18n-keys`, Prettier over `apps/*`, `docs` and `scripts`, eslint over the
     changed areas, `turbo typecheck` for `qcms-admin` and `qcms-api`, the whole admin suite
     (2184 tests) and the agent suites named above.
2. **Place the marker on a heading row.** `ProposalMarker` and its rules are built and
   tested, but no screen renders it yet: each kind's `card.headingControl` names the control
   it mirrors, and wiring a heading row to it is that screen group's work. D3 (links) is the
   first one whose kinds are runnable today.
3. **The Playwright paths and axe** over the card's eight states (criterion 11) are per
   screen group and belong with D3 onwards.
4. **D3 to D9.** D1 and D2 wait for PR #1200 (environment phase 5): it replaces the publish
   and release screens and deletes `publishFormAction` and `publishAndReleaseAction`, so
   `step-actions.ts` deliberately wires only `link.mint` and `link.revoke`, and says so. The
   `form.publish` and `form.release` descriptors stay on this branch because D0's own
   criteria need a kind whose environment comes from its arguments.
5. **The records** criterion 14 names (ADR-25's status, SEC-17's verified-by,
   `docs/agent-authoring.md` section 4, `docs/SECURITY_DESIGN.md` section 8, 038's header,
   the ledger rows, the work-order removals) are untouched and belong to the final PR.

## Decisions and constraints the next lane needs

- **The kinds offered in a turn are the current screen's**, not the form subtree's union, so
  a plan spanning two screens (`plan-three`, `plan-pending-at-1`) cannot become a card today
  even though the runner imports each step's own screen's action. That is the shape 082's
  registry and `screens.test.ts` fixed; it is recorded here as a discovery for the reviewer
  rather than changed, because widening it is a design call. The three-route run is asserted
  against the real routes instead.
- **A step with more than one reference fails closed** in `provenance.ts` and is refused at
  `propose_plan` (Code Owner, 2026-10-31). Widen both halves together.
- **The static conditional read-only sentence stays in the system prompt**, byte-identical
  for caching (Code Owner, 2026-10-31).
- `link.mint`'s descriptor takes its environment from the switcher while its route policy
  reads it from the body. The admin posts the switcher's environment, so the two agree;
  left as is by the Code Owner's open question to the reviewer.
- The eight card template keys are in `scripts/check-dead-i18n-keys.mjs`'s `ALLOWED`: the
  card renders `t(step.card.titleKey)`, and the API's descriptors name the keys, which the
  scan cannot read. `actions/registry.test.ts` pins each descriptor's keys to its kind.
- `control.agent_actions.detail` is text, so a reference's recorded value is compared as
  text.
- The **typed-confirmation gate** is on the card as a prop and tested with a synthetic step;
  D4's erasure kind is the first that supplies it.
- **Pending approval** is terminal for the plan in `plan-state.ts`; no D0 kind can return it
  yet, so the runner path is tested with a stubbed step result and D5's `prod` endpoint
  mechanism is what exercises it for real.
- **Issue #1190** (read-tool filtering) stays separate; not this task.
