HANDOFF: INTERRUPTED

Task 083, actions on every screen (`docs/features/083-agent-actions-every-screen.md`). D0's
server-side foundation **and its wiring into the turn** are on the branch and green. The D0
admin shell, the D0 fake-provider scripts and every screen group D1 to D9 are not started.

## Done

### The foundation (earlier lanes)

- **`apps/api/src/features/agent/proposal-token.ts`** and its tests: HMAC-SHA-256 over
  `{ v, purpose, sub, pid, steps: [{ kind, argsDigest, environment }], formId?, iat, exp }`
  through WebCrypto, key derived by HKDF-SHA-256 from `QCMS_APP_KEY` under
  `qcms/agent-proposal/v1`, canonical JSON with sorted keys at every depth, a
  `{ fromStep, field }` reference kept symbolic, `exp` ten minutes after `iat`,
  `PROPOSAL_MAX_STEPS` at 25, and `PROPOSAL_REFUSAL_CODES`. This lane added
  `unverifiedProposalId`, which selects the rows the verified check then reads.
- **`packages/db` migration 0007**: append-only `control.agent_actions`, `(proposal_id,
  step_index)` unique, no foreign key, the grant set emitted by the same function as
  `control.access_audit`'s, its `GRANT_SOURCES` row, the baseline's guarded per-environment
  `INSERT`, `writeAgentActionRow` with no `RETURNING`, `listProposalSteps`,
  `listAgentActions`, and a changeset.
- **The e2e grant assertions** in `apps/api/e2e/security/03-db-least-privilege.e2e.ts` and
  `04-db-restore-regrant.e2e.ts`.
- **`features/agent/actions/`**: the `ActionKindDef` descriptor type, the frozen registry
  with `actionKindForRoute`, and four kinds: `form.publish`, `form.release`, `link.mint`,
  `link.revoke`.
- **`grant-filter.ts`** and its tests: (kind, environment) pairs through `decideAccess`.
- **`tools/propose.ts`** and its tests: `buildProposal` with P1, P2, the hand-off rule, the
  reference checks and the ADR-41 publish-then-release-to-`prod` refusal.
- **`provenance.ts`** and its tests: the pure check over signature, subject, `exp` on step
  0, the run window, the index, the route, the recorded predecessors, replay, the recomputed
  arguments and the per-step environment.

### This lane

- **The provenance middleware is mounted.** `provenance-mount.ts` holds `agentProvenance`
  (the real check) and `agentProvenanceDisabled` (the `400`), and `registerAgentProvenance`
  installs one or the other on the flag. It sits **fourth in `registrars.ts`'s admin
  bucket**, after `registerGrantCheck`, so provenance is read from a request the route
  policy has already authorised. The environment a step is checked against is
  `grantContext.environment` when the policy row names one and the switcher's otherwise; an
  `environmentFrom: "targets"` row is refused rather than guessed. `ApiEnv.Variables` gains
  `agentProposal`. Tests: `provenance-mount.test.ts` (7).
- **The audit helper.** `features/agent/audit.ts` holds `agentStepSite(c)` and
  `writeAgentStep(exec, site, detail, confirmedAt)`. It is called **inside the step's own
  transaction** in all four D0 handlers: `forms/handler.ts` (publish, detail the version),
  `releases/handler.ts` (release, detail the version), `links/handler.ts` (mint, detail the
  count; revoke, detail the link id). The mint and revoke handlers were wrapped in a
  transaction for this, which is what makes "a failed step writes no row" true for them.
- **The propose tools are registered.** `propose_action` and `propose_plan` are in
  `AGENT_TOOL_NAMES` and `TOOLS`, over a `ctx.propose` port. `ProposalState` carries
  `actionProposals` (the P1 count) and `unsentProposals` (the flush queue).
  `tools/propose-schema.ts` builds the advertised schemas per caller: one union member per
  offered kind, each argument allowing a symbolic reference, and an argument kind's
  environment member narrowed to the caller's environments. `advertisedJsonSchema` exposes
  the provider-facing document to the tests. Tests: `tools/propose-schema.test.ts` (4).
- **The port** is built in `handler.ts`'s `actionPorts`: the screen's `actionKinds`, the
  caller's resolved grants, `offeredActionKinds`, the workspace's `requireSecondApprover`,
  `PRODUCTION_ENVIRONMENT`, the app key and the switcher environment. A caller offered
  nothing gets `offeredActionKinds: []` and neither tool, which is criterion 3's structural
  half.
- **`SCREENS.actionKinds`**: `form.publish` on the builder, `form.release` on the releases
  screen, `link.mint` and `link.revoke` on the links screen. `screens.test.ts` now asserts
  every declared kind is registered and sits on the screen its descriptor names.
- **The `action` and `plan` SSE events** are on `AssistEvent` and flushed from
  `assistant.ts` as each proposal is recorded, with a final flush in `finishTurn`. A turn
  that proposed an action no longer reports `NO_PROPOSAL`.
- **The `action-result` turn variant**: `ActionResultTurnBody` in `schema.ts` with a closed
  per-step schema (kind, outcome, scalar-only allowlisted result fields), `AssistTurn` is
  now a union, and `assistant.ts`'s `modelTurn` renders it from structured fields so no
  content re-enters the conversation.
- **The system prompt** gained the propose-tools and read-only sentences;
  `SYSTEM_PROMPT_VERSION` is 7.
- **The one-reference limit** is refused at the propose tool with a reason to the model, and
  recorded in the work order's D0 section (Code Owner, 2026-10-31). Test in
  `tools/propose.test.ts`.

## Next, in order

1. **Criterion 2's equivalence test, at integration level.** The mount tests cover the
   token-free pass-through and the refusals; what is missing is the DB-backed assertion that
   the *same* request with and without a token is authorised identically by route policy, in
   both directions (allowed stays allowed, refused stays refused). Put it beside
   `features/links/links.integration.test.ts`'s harness (`seedAdminSession`, `seedGrants`).
2. **The remaining SEC-17 D0 tests**, criterion by criterion: the replay rollback against
   Postgres, the two-environment plan (`plan-two-envs`), the reference resolved to a value
   other than the recorded one, the audit row written in the step's own transaction and
   absent for a failed step, and the result-redaction allowlist per kind.
3. **The fake-provider scripts** in `fake-model.ts`: `plan-three`, `plan-fails-at-2`,
   `unknown-tool`, `injection-follow`, `read-only-user`, `two-proposals`, `plan-26-steps`,
   `plan-two-envs` and `plan-pending-at-1`. Conductor decision of 2026-10-31: **`plan-three`
   runs at the API level** against the `form.publish`, `form.release` and `link.mint`
   descriptors, and neither the script nor its test says anything about screens; the
   screen-level Playwright path for publish and release waits for D1 and D2.
4. **The admin shell**: the card, the plan card, the hand-off variant, the sequential
   runner, the proposal marker, the step states, the focus and live-region rules, the
   `agent.*` catalog strings the descriptors' template keys name
   (`agent.card.link.mint.title` and the rest), and the trailing
   `{ agentProposal, step }` argument forwarding the two headers on each server action.
   Follow the design system's ActionCard, ProposalMarker and AssistantPanel cards and the
   four card rules as tests.
5. **D1 to D9**, with D1 and D2 held back (see below).

## Decisions and constraints the next lane needs

- **D1 and D2 are deferred** by conductor decision: environment phase 5 (issue #1197) is
  replacing the versions and releases screens with a Versions view and a publish wizard, and
  both groups propose publish, release, promote or roll back. The `form.publish` and
  `form.release` **descriptors** are on this branch anyway, because D0's own criteria cannot
  be tested without a kind whose environment comes from its arguments, and the API routes
  those descriptors name are not what #1197 changes. Their screen wiring, cards and
  Playwright paths stay with D1 and D2.
- **A step with more than one reference fails closed** in `provenance.ts` and is refused at
  `propose_plan` (Code Owner, 2026-10-31). Widen both halves together.
- **Issue #1190** (read-tool filtering) stays separate; not this task.
- `control.agent_actions.detail` is text, so a reference's recorded value is compared as
  text (`String(value) === detail`).
- `link.mint`'s descriptor takes its environment from the switcher while its route policy
  reads it from the body: the admin posts the switcher's environment, so criterion 9's "a
  plan proposed under `test` with the switcher moved to `prod` before Confirm is refused"
  falls out of the digest and environment checks rather than needing a second rule.

## Gates run on this head

- `pnpm exec turbo run typecheck lint`: 30 of 30 tasks successful.
- `apps/api` unit tests over `src/features/agent`, `links`, `releases`, `forms`: green.
- `pnpm check:comments`, `pnpm check:templates`, Prettier over `apps/api/src` and `docs`:
  green. The template mirror is resynced.
- The forced Docker-backed run, `pnpm up:e2e` and the browser suite have **not** been run on
  this head: D0 is not complete, so the final gate pass belongs to the lane that finishes it.
