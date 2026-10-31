HANDOFF: INTERRUPTED

Task 083, actions on every screen (`docs/features/083-agent-actions-every-screen.md`). D0's
server-side foundation is on the branch and green. The D0 wiring, the D0 admin shell and
every screen group D1 to D9 are not started.

## Done

- **`apps/api/src/features/agent/proposal-token.ts`** and its tests. HMAC-SHA-256 over
  `{ v, purpose, sub, pid, steps: [{ kind, argsDigest, environment }], formId?, iat, exp }`
  through WebCrypto, key derived by HKDF-SHA-256 from `QCMS_APP_KEY` under
  `qcms/agent-proposal/v1`, canonical JSON with sorted keys at every depth, `argumentsDigest`
  keeping a `{ fromStep, field }` reference symbolic, `exp` ten minutes after `iat`,
  `PROPOSAL_MAX_STEPS` at 25, and the `PROPOSAL_REFUSAL_CODES` list.
- **`packages/db` migration 0007** creating append-only `control.agent_actions` with
  `(proposal_id, step_index)` unique and no foreign key; the grant set emitted by the same
  function as `control.access_audit`'s (`appendOnlyAuditGrantStatements` in
  `src/environment/sql.ts`), its `GRANT_SOURCES` row, the baseline's guarded per-environment
  `INSERT` for an environment created later, `writeAgentActionRow` with no `RETURNING`,
  `listProposalSteps`, `listAgentActions`, and a changeset.
- **The e2e grant assertions** in `apps/api/e2e/security/03-db-least-privilege.e2e.ts`
  (grant-set equality with the access audit per role, the own-transaction insert, the
  `RETURNING` refusal, the replay on the unique constraint, read and write refusals, no
  foreign key) and in `04-db-restore-regrant.e2e.ts` (both audits through the re-grant).
- **`apps/api/src/features/agent/actions/`**: the `ActionKindDef` descriptor type, the frozen
  registry with `actionKindForRoute`, and four kinds: `form.publish`, `form.release`,
  `link.mint`, `link.revoke`.
- **`apps/api/src/features/agent/grant-filter.ts`** and its tests. Offers kinds on
  (kind, environment) pairs through `decideAccess`, binding a switcher kind to the turn's
  environment and narrowing an argument kind's enum to the environments the caller holds the
  cell in. ADR-41's production split falls out of the evaluator: an editor is offered no
  production release whatever its grant's scope.
- **`apps/api/src/features/agent/tools/propose.ts`** and its tests. `buildProposal` validates
  every step against its kind's schema, refuses a reference to a later step or an undeclared
  field, applies P1 and P2, refuses a hand-off step anywhere but last, refuses a
  publish-then-release-to-`prod` plan under `requireSecondApprover` with the ADR-41 reason,
  and mints the token.
- **`apps/api/src/features/agent/provenance.ts`** and its tests. `checkProvenance` covers
  signature, subject, `exp` on step 0, the ten-minute window from step 0's recorded
  confirmation for a later step, the index within the list, the route, steps `0` to `i-1` all
  recorded, replay, the recomputed arguments against the step's digest with a reference
  accepted only when it resolves to the value `control.agent_actions` recorded, and the
  environment the request is performed in against that step's own environment.

## Next, in order

1. **Mount the provenance check.** `provenance.ts` is a pure function; it needs a Hono
   middleware on the admin group, mounted only when the agent flag is on, reading
   `X-QCMS-Agent-Proposal` and `X-QCMS-Agent-Step`, resolving the matched route path and the
   route-policy environment source, loading `listProposalSteps`, and setting
   `c.var.agentProposal`. With the flag off, a request carrying the header is a `400`
   (`AGENT_PROPOSAL_DISABLED`). The equivalence test criterion 2 asks for belongs here: a
   request with and without a token authorised identically by route policy.
2. **The audit helper call** in each proposable handler, inside the step's own transaction,
   writing the row from `c.var.agentProposal` plus the kind's non-content detail.
3. **Wire the propose tools into the turn.** Add `propose_action` and `propose_plan` to
   `tools/registry.ts` over `buildProposal`, carry the proposals-this-turn count in
   `ProposalState`, build the port in `handler.ts` (app key, subject, switcher environment,
   `offeredActionKinds`, the workspace's `requireSecondApprover`, `PRODUCTION_ENVIRONMENT`),
   add `actionKinds` rows to `SCREENS`, add the `action` and `plan` events to `AssistEvent`
   and emit them from `assistant.ts` when a tool call records a proposal, add the
   `action-result` turn variant to `schema.ts` with its closed per-kind allowlist, and add
   the read-only sentence to the system prompt with a version bump.
4. **The fake-provider scripts**: `plan-three`, `plan-fails-at-2`, `plan-two-envs`,
   `plan-pending-at-1`, `two-proposals`, `plan-26-steps`, `unknown-tool`, `injection-follow`,
   `read-only-user`, and `propose-<kind>` per kind.
5. **The admin shell**: the card, the plan card, the hand-off variant, the sequential runner,
   the proposal marker, the `agent.*` catalog strings the descriptors' template keys name
   (`agent.card.link.mint.title` and the rest), and the trailing
   `{ agentProposal, step }` argument forwarding the two headers on each server action.
6. **D1 to D9**, with D1 and D2 held back (see below).

## Decisions and constraints the next lane needs

- **D1 and D2 are deferred** by conductor decision: environment phase 5 (issue #1197) is
  replacing the versions and releases screens with a Versions view and a publish wizard, and
  both groups propose publish, release, promote or roll back. The `form.publish` and
  `form.release` **descriptors** are on this branch anyway, because D0's own criteria (the
  two-environment plan of criterion 1, the reference check, the ADR-41 refusal of criterion 9)
  cannot be tested without a kind whose environment comes from its arguments, and the API
  routes those descriptors name are not what #1197 changes. Their screen wiring, cards and
  Playwright paths stay with D1 and D2.
- **`plan-three` as the work order words it** (publish, release the published version, mint
  links) spans the deferred groups. Either run it against the D0 descriptors at the API level
  only, or re-word it once #1197 merges.
- **A step with more than one reference fails closed.** `symbolicCandidates` substitutes one
  member at a time, which is the shape section 7.4 describes ("the version step 1 publishes").
  Widen it when a D-group needs a step with two references.
- `control.agent_actions.detail` is text, so a reference's recorded value is compared as text
  (`String(value) === detail`).
