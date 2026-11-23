- Next.js standalone output and its `server.js`: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js custom server, which cannot be combined with standalone output: https://nextjs.org/docs/app/guides/custom-server
- Hono mounted in a Next.js route handler: https://hono.dev/docs/getting-started/nextjs

# Plan: best-value architecture updates without a rebuild

> Status: DRAFT
> Created: 2026-11-23
> Baseline: `origin/main` at `b849f6ab`

## Summary

A from-scratch review of QCMS produced seven candidate architecture changes. Measured against the code, most of them do not pay back as retrofits: they cost a rebuild, reverse a recorded decision, or save less than they appeared to. This plan keeps the three that are cheap, respect every rule R1 to R8, and protect something that becomes permanent once real forms are published. V1 is a decision bundle of three questions for the Code Owner. V2 makes the rules evaluator dispatch by the semantics version a snapshot records, so a future semantics correction ships as a new version instead of an in-place change to the golden corpus. V3 completes task 096's parity audit in the other direction: every admin GET route is either mirrored by an agent read tool or carries a recorded reason why not. Nothing here changes the stack, a stored shape, a published snapshot or any respondent-facing behaviour. Everything else from the review is listed under "Not in this plan" with the reason and the trigger that would reopen it.

## Questions for the Code Owner (V1)

These are decisions, not work. Each has a recommendation and the evidence for it. Nothing in V2 or in the documents below is written as decided until ruled.

### Q1: does V2 go ahead of task 038?

- Recommendation: yes, scheduled ahead of 038 the way tasks 091 to 121 were. Whether it also gates launch is the ruling.
- `packages/core/golden/evaluator/CORPUS.md` records two corrections made in place without a `SEMANTICS_VERSION` bump. Both rest on the same argument: the evaluator implements one version and refuses any other stamp, so a bump "would make every already-published snapshot fail", and "the mechanism guards a migration path that does not exist yet".
- Before launch that argument is safe, because no deployment holds a published snapshot. After launch an in-place correction changes how a live published form evaluates, which is what R1 and ADR-16 promise never happens.
- V2 is kernel-only, adds no version and changes no golden file.
- The alternative is to defer it and record that no semantics correction may land until it exists.

### Q2: what is the stored compiled format called, and what is it tied to?

- Recommendation: option (a) below.
- Evidence, checked 2026-11-23:
  - A2UI 1.0 was released on 2026-11-11. Its wire format is a flat list of components referenced by id, sent in versioned message envelopes (`createSurface`, `updateComponents`, `updateDataModel`), with values bound through `@path`.
  - The stored documents, for example `packages/a2ui-compiler/golden/v4/minimal.a2ui.json`, are a nested tree of `{ type, props, children }` nodes with literal values. That is the `@a2ra/core` node format, which `docs/a2ui-mapping.md` already names as the specification QCMS compiles to.
  - The newest `@a2ra/core` on the registry is `1.0.0-preview.7`, the version already pinned. No release in the 1.0 wire shape exists.
- Why it needs a ruling now: ADR-18 serves the stored document forever, so the shape a version is published in is permanent for that version.
- Options:
  - (a) Record in ADR-18 and `docs/a2ui-mapping.md` that the stored documents are in the `@a2ra/core` node format at the pinned package version, that `a2uiSpecVersion` stamps that package version, and that no alignment with the A2UI 1.0 wire format is claimed. A later move to another shape is a new golden generation and never a rewrite of stored documents. Documentation only.
  - (b) Hold launch until `@a2ra/core` ships a 1.0-shaped schema and open generation `v5` in that shape. Costs a compiler and renderer generation before launch.
  - (c) Change nothing and leave the naming as it is.

### Q3: record the shape of agent-run questionnaires now?

- Recommendation: yes, as an amended acceptance sketch on item 5 of `docs/features/039-phase4-backlog.md`. Nothing is built.
- An agent that runs a questionnaire from a prompt conflicts with standing decisions, and each needs its own ruling before any design:
  - `docs/PROJECT_GOAL.md` section 3: the serving path contains no LLM.
  - ADR-14: adaptive behaviour cannot put an LLM in the serving path.
  - `docs/agent-principle.md` point 4 and its Limits: the agent never receives answer values, and respondents never meet it.
- Proposed sketch, for ruling:
  - It is a separate session mode beside pinned sessions, never a change to them.
  - The agent emits library question ids or question definitions that the kernel validates. It never emits a UI document or markup.
  - Every question is recorded on the session as asked, because no frozen version exists to answer "what was asked".
  - Respondent answers reaching a model provider is a new SEC decision.
- External references the sketch should cite: MCP elicitation form mode restricts an agent's request to flat primitive fields that match the seven question types; provider structured outputs constrain a model to a JSON Schema but do not enforce numeric ranges or string lengths, so kernel validation stays the authority.

## Architecture

### V2: evaluator dispatch by semantics version

Today `evaluateRules` in `packages/core/src/evaluate-rules.ts` compares a snapshot's `semanticsVersion` with the constant `SEMANTICS_VERSION` and returns `UNSUPPORTED_SEMANTICS_VERSION` for anything else. V2 replaces the comparison with a lookup.

```
evaluateRules(snapshot, answers, resolveQuestion, rosters)
   |
   |-- stamped snapshot  --> registry[snapshot.semanticsVersion]
   |-- bare definition   --> registry[SEMANTICS_VERSION]      (draft preview, rule test bench)
   |-- unknown stamp     --> UNSUPPORTED_SEMANTICS_VERSION    (unchanged)
   v
semantics/v1.ts   the current walk, moved without edits
```

- `SEMANTICS_VERSION` stays `1` and stays the version stamped into new snapshots.
- The registry is a plain map from version number to implementation. `createEvaluator(table)` builds the dispatcher from a table, so a test can prove dispatch with a stub second version without shipping one.
- `FlowState` stays one shared shape. A future version that needs a different shape is its own decision.
- The golden runner reads an optional `semanticsVersion` on each scenario, defaulting to `1`, and evaluates the scenario under that version. The 59 existing scenario files are not touched.
- `CORPUS.md` gains the rule that replaces in-place correction: a changed expectation is a new scenario under a new version, and the old scenario keeps passing under its own.
- Callers do not change: `apps/api/src/features/responses/serve-step/handler.ts`, `apps/api/src/features/responses/submit/handler.ts` and `apps/api/src/features/forms/handler.ts` keep calling `evaluateRules`.
- The five engine decisions in `docs/adr/proposals.md` each state that `SEMANTICS_VERSION` stays 1, so V2 neither blocks them nor depends on them.
- .NET mapping: this is keyed services. One `IEvaluator` is registered per version and resolved by the key the snapshot carries, the way API versioning selects a controller.
- For whoever adds version 2 later: it starts as a copy of `semantics/v1.ts`, so `pnpm check:duplication` will need an exclusion for `packages/core/src/semantics/` in `.jscpd.json` at that point. Not in this plan.

### V3: every admin GET route has a read tool or a recorded reason

Task 096 built `apps/api/src/features/agent/parity.test.ts`. Its `TOOL_ROUTES` table names the route each read tool mirrors, and the test proves each tool declares that route's own cell from `ROUTE_POLICIES`. That is the tool-to-route direction.

The route-to-tool direction is not checked. `docs/agent-principle.md` rules "one typed read tool per admin GET route", and at the baseline `apps/api/src/features/membership/route-policy.ts` holds 38 GET paths of which `TOOL_ROUTES` mirrors 14. The other 24 have no tool and no recorded reason. Some are clearly right: `/admin/forms/{id}/responses/{sessionId}` and `/admin/forms/{id}/export` return answer values, which point 4 of the principle forbids. Others, such as `/admin/workspaces/{id}/members`, `/admin/workspaces/{id}/audit` and `/admin/release-workflow`, read as either covered by another tool's output or as gaps. Today nothing makes that a decision, so a new GET route can arrive unmirrored without anyone ruling on it.

- `parity.test.ts` gains a table of unmirrored GET routes, each with a reason from a small closed set: returns respondent content, Site administrator surface, served by another tool (named), binary or file response, or open gap (issue number).
- A new test walks every `GET` row of `ROUTE_POLICIES` and fails unless the path is in `TOOL_ROUTES` or in that table, and fails if a path is in both.
- Classifying the 24 is the work. A route classed as an open gap gets a GitHub issue; no tool is added in this plan.
- No tool, port, schema or runtime path changes.

### Files to create

| File                                           | Purpose                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/core/src/semantics/v1.ts`            | The version 1 walk, moved from `evaluate-rules.ts` without edits                                        |
| `packages/core/src/semantics/registry.ts`      | The version table, `SUPPORTED_SEMANTICS_VERSIONS`, `createEvaluator(table)` and `evaluatorFor(version)` |
| `packages/core/src/semantics/registry.test.ts` | Dispatch tests, including a stub second version held in the test                                        |
| `.changeset/<generated-name>.md`               | Minor bump for `@roonga/qcms-core`: new exports, no behaviour change                                    |

### Files to modify

| File                                         | Change                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/evaluate-rules.ts`        | Keeps the public types, `SEMANTICS_VERSION` and `evaluateRules`; the stamp comparison becomes a registry lookup |
| `packages/core/src/index.ts`                 | Exports `SUPPORTED_SEMANTICS_VERSIONS`                                                                          |
| `packages/core/src/golden-corpus.test.ts`    | Optional `semanticsVersion` on the scenario schema; each scenario runs under its version                        |
| `packages/core/golden/evaluator/CORPUS.md`   | The per-version rule; the two recorded exceptions stay as history                                               |
| `docs/adr/core.md`                           | ADR-16 Note recording the dispatch; ADR-18 Note per the Q2 ruling                                               |
| `docs/DOMAIN_SCHEMA.md`                      | Section 3, evaluation semantic 4: old snapshots evaluate under their recorded version, now by mechanism         |
| `docs/a2ui-mapping.md`                       | Format statement per the Q2 ruling                                                                              |
| `docs/features/039-phase4-backlog.md`        | Item 5 acceptance sketch per the Q3 ruling                                                                      |
| `apps/api/src/features/agent/parity.test.ts` | The unmirrored-route table and the route-to-tool test                                                           |
| `apps/api/src/features/agent/README.md`      | The `parity.test.ts` row names both directions                                                                  |
| `docs/SECURITY_DESIGN.md`                    | Section 8d (SEC-17): the gate named as the enforcement of read-tool coverage                                    |

## Security

- [ ] Input validation: no new input enters the system. V2 changes how a stored stamp selects an implementation; an unknown stamp is refused exactly as today. V3 is test-only.
- [ ] Authentication / authorisation: unchanged at runtime. V3 makes "which admin reads the agent may make" a reviewed list in both directions, so a new GET route cannot ship without a decision. No grant, role or route policy changes.
- [ ] SQL / injection: N/A. No query is added or changed.
- [ ] XSS: N/A. No rendered output changes.
- [ ] Secrets: N/A. No secret, key or environment variable is added.
- [ ] Dependency risk: none added. Both steps use only what the packages already depend on.
- [ ] Data exposure: V2 keeps the rule that evaluator messages name ids and never answer values. V3's table is where a route returning answer values is recorded as unmirrored, so SEC-17's "no respondent content" boundary gains a static check beside the sentinel tests in `apps/api/src/features/agent/assist.integration.test.ts`.

## Implementation steps

Size: S under a day, M two to three days. Tier: F Fable, O Opus, S Sonnet. Each row is one branch and one PR, and takes a work-order number when scheduled.

| ID  | Task                                                                                                           | Deps | Size | Tier            |
| --- | -------------------------------------------------------------------------------------------------------------- | ---- | ---- | --------------- |
| V1  | Decision bundle: Q1 to Q3 ruled, then the ADR-18 Note, `docs/a2ui-mapping.md` statement and the phase-4 sketch | none | S    | F               |
| V2  | Evaluator dispatch by semantics version, per-version golden runner, `CORPUS.md` rule, ADR-16 Note              | Q1   | M    | O, Fable review |
| V3  | Route-to-tool coverage in the agent parity audit                                                               | none | S    | O, Fable review |

- [ ] **Step 1 - V1 decision bundle**
  - Put Q1 to Q3 to the Code Owner with the evidence above.
  - Write only what is ruled: the ADR-18 Note and `docs/a2ui-mapping.md` statement (Q2), the item 5 sketch in `docs/features/039-phase4-backlog.md` (Q3), the scheduling of V2 (Q1).
  - Acceptance: each question has a recorded ruling with its date; `pnpm check:plan` is green; no file outside the fast-lane set changed.

- [ ] **Step 2 - V2 move the version 1 walk**
  - Move the evaluation walk from `packages/core/src/evaluate-rules.ts` to `packages/core/src/semantics/v1.ts` with no edits to its logic. `evaluate-rules.ts` keeps the public surface and calls it.
  - Acceptance: `pnpm test:golden-drift` passes; `pnpm check:golden-append-only` passes; no file under `packages/core/golden/` changed.

- [ ] **Step 3 - V2 registry and dispatch**
  - Add `packages/core/src/semantics/registry.ts`; make `evaluateRules` look the stamp up; export `SUPPORTED_SEMANTICS_VERSIONS`.
  - Acceptance: a snapshot stamped `1` evaluates as before; a stamp outside the table returns `UNSUPPORTED_SEMANTICS_VERSION`; a bare `FormDefinition` evaluates under `SEMANTICS_VERSION`; `SEMANTICS_VERSION` is still `1`.

- [ ] **Step 4 - V2 per-version corpus and records**
  - Golden runner honours an optional `semanticsVersion`; update `CORPUS.md`, the ADR-16 Note and `docs/DOMAIN_SCHEMA.md`; add the changeset.
  - Acceptance: all 59 scenarios pass unchanged; a scenario declaring an unregistered version fails with a message naming it; `pnpm check:changeset` and `pnpm check:adr-citations` pass.

- [ ] **Step 5 - V3 route-to-tool coverage**
  - Classify the 24 unmirrored GET routes; add the table and the test to `apps/api/src/features/agent/parity.test.ts`; open an issue for each open gap; update the agent README and SEC-17.
  - Acceptance: the test fails when a GET row is added to `ROUTE_POLICIES` with neither a tool nor a reason, when a path is in both tables, and when a reason is outside the closed set; the existing cases in `parity.test.ts` pass untouched.

## Testing plan

### Unit tests

| Subject                        | Cases to cover                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEvaluator(table)`       | routes a stamp to its implementation; two versions in one table reach different implementations; unknown stamp is a typed error; bare definition uses the current version |
| `evaluateRules()`              | every existing case in `evaluate-rules.test.ts` and `prepare-submission.test.ts` passes without edits                                                                     |
| `SUPPORTED_SEMANTICS_VERSIONS` | contains `SEMANTICS_VERSION`; is sorted and frozen                                                                                                                        |
| Golden runner                  | default version is `1`; a declared version is honoured; an unregistered declared version fails by name                                                                    |
| Route-to-tool coverage         | every GET row is in `TOOL_ROUTES` or the unmirrored table; no path is in both; every reason is in the closed set; an open gap names an issue                              |

Files: `packages/core/src/semantics/registry.test.ts`, `packages/core/src/golden-corpus.test.ts`, `apps/api/src/features/agent/parity.test.ts`

### Component tests

N/A. No React component, control or rendered document changes in any step.

### E2E tests

No new scenario. The steps change no behaviour, so the proof is that the existing suites pass unmodified:

- [ ] `apps/api/e2e` scenario suite and `apps/api/e2e/security/matrix-coverage.e2e.ts`
- [ ] The full-stack flow in `apps/e2e/full-stack-conditional-form.pw.ts`, through `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`, once after V2

### Axe / accessibility

N/A. No interactive component is added or changed, so no axe gate has new input. Task 030's manual pass is unaffected.

## Static code analysis

All checks must be green before a step merges.

- [ ] `pnpm verify` on V2 and V3: the full merge gate, which includes `check:all`, build, typecheck, lint, test and `test:golden-drift`
- [ ] `pnpm check:plan` on V1, which stays on the instruction and plan fast lane
- [ ] `pnpm check:golden-append-only` on V2: no scenario, form or question file under `packages/core/golden/evaluator/` modified
- [ ] `pnpm check:comments` and `pnpm check:no-em-dash` on every step
- [ ] `pnpm verify:browser` is not required: no step touches `apps/portal`, `apps/admin` or `@roonga/qcms-ui`

## Definition of done

- [ ] Q1 to Q3 each carry a recorded Code Owner ruling
- [ ] Every implementation step above is checked off, each row on its own branch and PR
- [ ] All listed unit tests are written and passing, and the existing suites pass without edits
- [ ] All static analysis checks are green
- [ ] A changeset is added for `@roonga/qcms-core`
- [ ] Each PR has an independent review with an `AGENT-REVIEW: APPROVE` verdict at its current head, a Fable first review on V2 and V3, and green CI

## Not in this plan

Line counts are non-test source at the baseline.

| Change from the review                                                            | Why it is left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What would reopen it                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Removing the BFF layers, with the admin served by the API as a client application | Rewrites how every admin page loads its data. The proxy layers are about 7,000 of the admin's 56,000 lines and about 2,400 of the portal's 6,200, so the saving is small. It reverses ADR-08 and ADR-35 and repeats the security review                                                                                                                                                                                                                                                                                | A rewrite                                                                             |
| Portal plus one combined admin and API process                                    | Considered on 2026-11-23 and 2026-11-24 and not taken forward. It saves one container and no code. Keeping the API off the published admin port means two listeners and an in-memory hook in one process, which is an uncommon composition to maintain, and it needs an ADR-35 exception that puts the API's credentials beside the Next.js admin server. The conventional alternative, mounting the API in a Next.js route, serves API routes on the admin listener and pulls database packages into the admin bundle | An adopter who needs fewer services, for example on a host that charges per container |
| Removing Hono so the API becomes Next.js route handlers                           | The portal still needs a network API, Next.js has no equivalent for route groups that do not exist unless mounted (ADR-09) or for the generated OpenAPI documents, and the API is about 42,000 non-test lines with 119 route definitions. It would also tie the API to Next.js, which R4 exists to avoid                                                                                                                                                                                                               | A rewrite                                                                             |
| Portal and API in one process                                                     | Puts database credentials in the internet-facing process                                                                                                                                                                                                                                                                                                                                                                                                                                                               | None foreseen                                                                         |
| Dropping the stored compiled documents                                            | Reverses ADR-01 and ADR-18 and touches about 65 source files across nine packages and apps                                                                                                                                                                                                                                                                                                                                                                                                                             | A Code Owner ruling before launch; not recommended now                                |
| One control set in the portal, so nothing is swapped at hydration                 | Restructures `apps/portal/components/step-flow.tsx` (929 lines) and repeats the portal accessibility evidence, including task 030                                                                                                                                                                                                                                                                                                                                                                                      | Measured loss of respondent input on a throttled device                               |
| One session event log in place of the answer and roster ledgers                   | Rewrites the most audited tables for a modest gain                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | None foreseen                                                                         |
| Grants stored outside the better-auth organisation tables                         | better-auth is imported in six API files and QCMS's own resolver already decides every grant; the gain is coupling, not behaviour                                                                                                                                                                                                                                                                                                                                                                                      | A better-auth upgrade that breaks the plugin tables, or the C1 to C3 identity work    |
| Environments by row-level security                                                | Schema grants are the stronger isolation for deployments holding personal data                                                                                                                                                                                                                                                                                                                                                                                                                                         | None foreseen                                                                         |
| Shipping an image with extension points in place of scaffolded source             | A product decision (ADR-05), not an engineering one                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The Code Owner                                                                        |
| Generating agent tools from route definitions                                     | Tool output schemas are deliberately narrower than route responses, and task 096 with V3 gives the drift protection without it                                                                                                                                                                                                                                                                                                                                                                                         | None foreseen                                                                         |
| A decimal answer type                                                             | The Code Owner ruled a decimal-place limit on `number` (issue #1293, `docs/adr/proposals.md`), which covers the money case without a new type                                                                                                                                                                                                                                                                                                                                                                          | None foreseen                                                                         |

## Sources

Checked 2026-11-23.

- A2UI 1.0 protocol specification: https://a2ui.org/specification/v1.0-a2ui/
- A2UI 1.0 release announcement: https://developers.googleblog.com/en/a2ui-10-build-delightful-fast-reliable-agentic-experiences/
- MCP elicitation, form mode: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- MCP Apps extension: https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Structured outputs and their JSON Schema limits: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- `@a2ra/core` registry listing: `npm view @a2ra/core dist-tags versions`
