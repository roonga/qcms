# 073 - Repeat rendering, the roster operation, both paths, and issue #968

**Stage:** 8c (launch scope) · **Apps/packages:** `@roonga/qcms-a2ui-compiler`, `@roonga/qcms-ui` (the renderer), `apps/api`, `apps/portal`, `packages/create-qcms-app` (the template mirror) · **Depends on:** 071 (the model), 072 (the roster's home and its derivation)
**References:** ADR-43 (the decision) · ADR-42 · ADR-01 as amended 2026-09-30 (the compiler emits a template the renderer expands) · ADR-14 as amended 2026-09-30 (the roster reaches the renderer without widening `StepResolverContext`) · ADR-18 as amended 2026-09-30 (`a2uiSpecVersion` and a new golden generation) · ADR-31 as noted 2026-09-30 (no commit-moment row changes) · ADR-12 (the honeypot) · SEC-16 · SEC-9 · `docs/portal-constraints.md` · `plan/repeating-groups-and-table-input.md` sections 4.1 to 4.4, and Q9, Q11, Q12, Q15, Q20, Q21 · R2 · **issue #968** · issue #920 · issue #144

## Context

This is where the two hardest problems live. `compileFormWith` is pure and answer-blind, so it cannot expand a group: an instance count is answer-dependent. And nothing in the portal handles a non-submit action button today, while `docs/portal-constraints.md` makes an **unqualified** no-JS claim with an empty exception list.

The answers to both are ADR-43's. The compiler emits a `RepeatGroup` **template** and the renderer clones it per live instance at render time, which keeps ADR-18 exact. Add and remove ride the step's own form as **named submit buttons**.

**One ruling of 2026-09-30 governs the shape of the whole no-JS half:** an Add or Remove post applies **only the roster operation** and commits **no answers**. An earlier draft of the plan had it applying the step's answers first, which would write a whole step to the ledger on a button press that is not a Continue. It does not.

## Deliverables

- **The compiler's `RepeatGroup` template node**, a qcms-owned node type on the `HONEYPOT_NODE_TYPE` precedent rather than an `@a2ra/core` registry component, carrying the member controls once with the bare `questionId` as each `name`. `A2UI_SPEC_VERSION` and `COMPILER_VERSION` move; the documented spec-bump procedure opens a **new golden generation** carrying the seven existing forms across byte-identically plus new repeat forms. `docs/a2ui-mapping.md` gains the node.
- **Render-time expansion**: the renderer clones the template per live instance in roster order and rewrites each cloned control's `name` to `ins_7k2/q_passport`, keyed per instance (issue #144's rule, one control instance per field). The **qualified name is the field's whole identity below the API**, so `documentForVisible`'s pruning, `commitMoments`, the `FieldBlur` wrapper's `id` and `data-qcms-field`, the adapter `key`, the `__qk__` and `__qa__` markers, the BFF decoder and the error summary's anchors each keep keying on one opaque string and none of them learns about instances.
- **The API's step projection carrying the roster**, beside `values` and `flowState`. `StepResolverContext` is **not** widened (ADR-14's amendment), and the portal still evaluates nothing (R2).
- **The batch answer endpoint** (Q20), used by Continue. It carries a Continue's answers only; the roster operation is its own call. **It is rate limited per entry, not per request**: `answersPerSessionLimiter` spends one unit per request today, so a batch of N answers spends N units of the same per-session allowance and a batch exceeding the remainder is refused rather than partially applied (SEC-16).
- **The roster-operation endpoint**, refusing an add that would exceed the group's `max`, refusing a `fromAnswer` count above `max` at the count question, and carrying its own rate limit beside the answer write.
- **The fix for issue #968, in this task** (Q20). The required-answer sweep moves inside the session lock, so a concurrent retraction cannot leave the ledger and the submission out of step, and the batch endpoint takes that lock once for a whole step. A repeat multiplies #968's window by the number of fields a step posts, and the no-JS path posts a whole step at once, which is why it is a deliverable here rather than a dependency scheduled elsewhere.
- **The no-JS roster operation**: `__qop` as a fourth reserved prefix in `decodeStepForm` beside `__qk__`, `__qa__` and the honeypot's `website`; `formnovalidate` on the Add and Remove buttons; and the ruled behaviour of that post, which is three things:
  1. the roster operation is applied;
  2. **no answer is written**, so an emptied required field on that post is neither stored nor retracted;
  3. the typed values are carried back for the re-render, and reach the ledger only on Continue under ordinary validation.
- **The carrier for those typed values is the POST body**: the `__qop` request re-renders the step in its own **200** response rather than redirecting. Nothing else scales, because the set is the whole step rather than a refused subset and the whole step at nine instances does not fit a 4 KB cookie. **The roster operation therefore carries a one-time operation token**, minted into each button's value (`add:grp_passengers:op_7f3`) and recorded with the roster row, so a reload or a Back replays nothing and re-renders the same instances. The Continue path keeps its 303 and its cookie.
- **The Continue path's re-render change** (Q21): `values` and `missingRequired` from the API's step projection, and the cookie keeping the capped 422 errors as **`{error, constraint, value}` per refused field**, the cap **stated in fields**. Without the value, a refused cell re-renders blank beside a message about what the respondent typed, which is a WCAG 3.3.7 failure. On overflow: keep the first N, drop the rest, say some messages could not be carried, and return the full set on the next Continue.
- **Focus, announcement and the error summary**: after an add, the new instance's heading; after a removal, the instance that took its place, then the **previous** instance when the removed one was last, then the **Add button** when the removed one was the only instance. A `role="status"` region on the scripted path only, written as a whole sentence. Summary entries reading "Passenger 2: passport number is required", anchored at the qualified field id.
- **The stacked presentation** (Q12): **one input per row**, a single column with no two fields side by side at any width, and **all seven** question types allowed.
- **All three count sources** served, with the roster derivation 072 provides.
- **`docs/portal-constraints.md` updated in the same change**, its exception list still empty. **Its "a required question cannot be CLEARED without scripting" bullet is unchanged**, because no answer write happens on an Add or Remove post; assert that rather than amending it.
- **One honeypot decoy per step**, never cloned: the decoy sits outside the `RepeatGroup` template.
- **The template mirror** under `packages/create-qcms-app/templates/common/apps/api/src/features/responses/serve-step/handler.ts`, which `check:templates` enforces byte for byte.
- **Changesets** for the compiler and the UI package.

## Exit criteria

Acceptance cases **4, 5, 27 to 38, and 54 to 57** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others. Plus:

1. The no-JS claim's seven named specs still pass and an eighth joins them for the repeat walk; `docs/portal-constraints.md`'s exception list is still empty.
2. **The "cannot be CLEARED without scripting" bullet is proved unchanged**: case 27 asserts that an Add post with an emptied previously answered required field writes no answer row and appends no retraction, so the ledger holds what it held before.
3. **A replayed `__qop` post applies the roster operation once**, asserted by reloading the 200 response, which the one-time token is what makes true.
4. **Issue #968 closes with this PR**, with a test that fails against the pre-change ordering rather than a claim that the ordering changed.
5. The seven existing compiler golden documents are byte-identical in the new generation, and the append-only guard covers both trees.
6. `pnpm verify` green; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` green, run detached; the forced Docker-backed run confirmed to have executed; `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` green.

## Files and areas

`packages/a2ui-compiler/src/` and `packages/a2ui-compiler/golden/` (a new generation, appended), `packages/ui/src/` (the renderer's expansion and name qualification), `apps/api/src/features/responses/` (step projection, the batch endpoint, the roster endpoint, the submit sweep for #968, rate limits), `apps/portal/lib/server/step-form.ts`, `apps/portal/app/s/[sessionId]/step/route.ts`, the portal's step view and error summary, `docs/a2ui-mapping.md`, `docs/portal-constraints.md`, `packages/create-qcms-app/templates/common/`, changesets.

## Gates

All four: `pnpm verify`; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached` then `pnpm verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground (issue #846); the forced Docker-backed run; and `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`. The forced run and `verify:browser` are mutually exclusive on one checkout, so run them in sequence (issue #863), and do not run `up:e2e` concurrently with `verify:browser` on the same seat.

## Out of scope (binding)

The per-instance step presentation (076) and the table presentation (077): this task ships **stacked** only, and the other two are separate tasks that depend on it. The admin beyond what 071 already carried (074). Export, reporting and the webhook payload (075). Any commit-moment change: a repeat is a layout and ADR-31's table does not move. Nesting, instance reordering and cross-instance references.

## Notes for the executor

**The 200 re-render is a deliberate departure from the 303, confirmed by the Code Owner on 2026-09-30**, recorded in ADR-43 and in plan section 4.2, and the token is what pays for it. Do not "fix" it back to a redirect without the carrier problem solved, and do not carry a whole step's values in the cookie: that is the failure Q21 exists to prevent, arrived at from the other side.

**`formnovalidate` is safe only because the post writes nothing.** If you find yourself writing the step's answers on the `__qop` path, stop: that is the shape the 2026-09-30 ruling refused, and it reopens the required-clear path the 2026-09-13 ruling closed.

**Expansion is a clone, so the honeypot is a real risk.** Assert that a ten-instance step carries exactly one decoy, on the compiled document and on the DOM.
