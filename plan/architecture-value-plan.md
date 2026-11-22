# Plan: best-value architecture updates without a rebuild

> Status: DRAFT
> Created: 2026-11-23
> Baseline: `origin/main` at `b849f6ab`

## Summary

A from-scratch review of QCMS produced seven candidate architecture changes. Measured against the code, most of them do not pay back as retrofits: they cost a rebuild, reverse a recorded decision, or save less than they appeared to. This plan keeps four. V1 is a decision bundle of four questions for the Code Owner. V2 makes the rules evaluator dispatch by the semantics version a snapshot records, so a future semantics correction ships as a new version instead of an in-place change to the golden corpus. V3 completes task 096's parity audit in the other direction: every admin GET route is either mirrored by an agent read tool or carries a recorded reason why not. V4 adds a compact topology, portal plus one combined admin and API process, as an opt-in beside the current one. V2 and V3 are cheap and change no boundary. V4 is the largest item and the only one that moves a security boundary, so it starts with a spike and waits on its own ruling. Nothing here changes the stack, a stored shape, a published snapshot or any respondent-facing behaviour. Everything else from the review is listed under "Not in this plan" with the reason and the trigger that would reopen it.

## Questions for the Code Owner (V1)

These are decisions, not work. Each has a recommendation and the evidence for it. Nothing in V2 to V4 or in the documents below is written as decided until ruled.

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

### Q4: admin and API in one process?

The Code Owner asked on 2026-11-23 for this to be planned, as portal plus a combined admin and API. Planning it is not the ruling. V4 needs these four points ruled:

1. **The ADR-35 exception.** In the compact topology the process that serves the admin holds the database handles. Admin source still imports no database package, and `apps/admin/lib/server/r2-import-surface.test.ts` stays as it is.
   - What that costs: a vulnerability in the Next.js admin server would then sit beside the credentials the API holds, which are the database roles for `control` and every environment, the auth secret, the agent key and the SMTP password. Today it sits beside the internal token alone.
   - Recommendation: accept it for the compact topology only, recorded as an amendment to ADR-35.
2. **Opt-in or replacement.** Recommendation: opt-in. `docker-compose.yml` and ADR-20's four-container reference stay the default, so tasks 038 and 040 are unaffected. A later ruling can promote it.
3. **How it is kept green.** Recommendation: the compact stack runs in the manually dispatched `e2e.yml` workflow, not as a fifth required check, until it is promoted.
4. **When.** Recommendation: after 040's sign-off, because it changes a trust boundary that review covers.

What it gives: the solo deployment goes from four containers to three, and admin page loads lose a network hop. It saves no code, because the BFF wrappers stay.

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

### V4: portal plus one combined admin and API process

```
Default topology (unchanged)            Compact topology (opt-in)

portal --http--> api --> postgres       portal --http--> [ admin + api ] --> postgres
admin  --http--> api                                      one process, two listeners
```

What makes this cheap to try:

- Every admin call to the API goes through one function, `loggedFetch` in `apps/admin/lib/server/api.ts`, with one `fetch` call.
- The API handlers are fetch-pure (R4), so the Hono app can be handed a `Request` directly.
- .NET mapping: it is the same swap as giving `HttpClient` an in-memory handler and hosting the controllers in the same process.

What does not move:

- **The portal.** It stays its own process, holds no database handle, and reaches the respondent routes over the internal network with the internal token, exactly as now.
- **Exposure.** The combined process keeps two listeners. The admin listener is the one ingress reaches. The API listener stays unpublished and is what the portal calls, so "the API container is not published" still describes the API surface.
- **Every check inside the API.** An in-memory request carries the same internal token, admin session, environment and request id headers, and runs the same middleware chain, route policy and audit as a network one.
- **The admin source.** It gains no import of the API or of any database package. The API publishes its request handler on a process-global hook, and `loggedFetch` uses the hook when it is present and `fetch` when it is not, so one admin build serves both topologies.
- **Development.** `pnpm dev:admin` and `pnpm dev:portal` keep starting separate processes. The combined process is a production image composition only, which avoids duplicate pools and schedulers under dev reloads.

What has to be built:

- **A start function for the API.** `main` in `apps/api/src/main.ts` builds the dependencies, starts the schedulers, binds the port and installs the signal handlers in one body. It is split so the composition can be started and stopped by a caller.
- **A combined entry.** It starts telemetry, then the API with its listener and schedulers, publishes the hook, then starts the admin's standalone server. Next.js documents `server.js` as the way to run a standalone build and documents that a custom server cannot be combined with standalone output, so loading `server.js` from a parent entry is unproven. Step 6 is the spike that settles it. The fallback it tests is starting the API from the admin's documented `register()` hook in `apps/admin/instrumentation.ts`, loading it by runtime path so the admin source still imports nothing.
- **One telemetry SDK.** The API starts a `NodeSDK` and the admin registers `@vercel/otel`; a process can hold one. The combined process runs the API's, with the Next.js span redaction from `@roonga/qcms-observability` added to it, and the admin's `register()` skips its own registration there. The in-memory hop has no `fetch` span, so the hook wrapper injects `traceparent` itself to keep one connected trace.
- **One shutdown.** A single `SIGTERM` path that closes both listeners, stops the schedulers, ends the pools and flushes telemetry last.
- **An image and a Compose variant.** `docker/admin-api.Dockerfile` and `docker-compose.compact.yml`, with a health check that reads both the admin's `/healthz` and the API's `/ready`. The API listener's in-container port is allocated in `docs/PORTS.md` by that PR (R8); none is invented here.

### Files to create

| File                                           | Purpose                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/core/src/semantics/v1.ts`            | The version 1 walk, moved from `evaluate-rules.ts` without edits                                        |
| `packages/core/src/semantics/registry.ts`      | The version table, `SUPPORTED_SEMANTICS_VERSIONS`, `createEvaluator(table)` and `evaluatorFor(version)` |
| `packages/core/src/semantics/registry.test.ts` | Dispatch tests, including a stub second version held in the test                                        |
| `.changeset/<generated-name>.md`               | Minor bump for `@roonga/qcms-core`: new exports, no behaviour change                                    |
| `apps/admin/lib/server/embedded-api.ts`        | Reads the process-global hook and types it as a request handler; imports nothing from the API (V4)      |
| `apps/admin/lib/server/embedded-api.test.ts`   | Hook present and absent, header and body pass-through, streamed responses (V4)                          |
| `apps/api/src/serve-combined.ts`               | The combined entry, in the shape the spike selects (V4)                                                 |
| `docker/admin-api.Dockerfile`                  | The `qcms-admin-api` image (V4)                                                                         |
| `docker-compose.compact.yml`                   | Portal, combined admin and API, Postgres, with the one-shot roles and migrate services (V4)             |

### Files to modify

| File                                                                            | Change                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/evaluate-rules.ts`                                           | Keeps the public types, `SEMANTICS_VERSION` and `evaluateRules`; the stamp comparison becomes a registry lookup       |
| `packages/core/src/index.ts`                                                    | Exports `SUPPORTED_SEMANTICS_VERSIONS`                                                                                |
| `packages/core/src/golden-corpus.test.ts`                                       | Optional `semanticsVersion` on the scenario schema; each scenario runs under its version                              |
| `packages/core/golden/evaluator/CORPUS.md`                                      | The per-version rule; the two recorded exceptions stay as history                                                     |
| `docs/adr/core.md`                                                              | ADR-16 Note recording the dispatch; ADR-18 Note per the Q2 ruling; ADR-35 amendment and ADR-20 Note per the Q4 ruling |
| `docs/DOMAIN_SCHEMA.md`                                                         | Section 3, evaluation semantic 4: old snapshots evaluate under their recorded version, now by mechanism               |
| `docs/a2ui-mapping.md`                                                          | Format statement per the Q2 ruling                                                                                    |
| `docs/features/039-phase4-backlog.md`                                           | Item 5 acceptance sketch per the Q3 ruling                                                                            |
| `apps/api/src/features/agent/parity.test.ts`                                    | The unmirrored-route table and the route-to-tool test                                                                 |
| `apps/api/src/features/agent/README.md`                                         | The `parity.test.ts` row names both directions                                                                        |
| `apps/api/src/main.ts`                                                          | Split into a start function that returns the app and a stop function, and the `main` that binds signals (V4)          |
| `apps/api/src/telemetry.ts`                                                     | Adds the Next.js span redaction when started by the combined entry (V4)                                               |
| `apps/admin/lib/server/api.ts`                                                  | `loggedFetch` dispatches through the hook when present (V4)                                                           |
| `apps/admin/instrumentation.ts`                                                 | Skips its own telemetry registration in the combined process (V4)                                                     |
| `apps/admin/lib/server/r2-import-surface.test.ts`                               | Adds `qcms-api` to the forbidden imports (V4)                                                                         |
| `scripts/build-images.mjs`, `scripts/compose-e2e.mjs`                           | The fourth image and a compact run (V4)                                                                               |
| `.github/workflows/images.yml`, `.github/workflows/e2e.yml`                     | Build and scan the image; a manually dispatched compact run (V4)                                                      |
| `packages/create-qcms-app` templates                                            | Regenerated by `pnpm qcms:sync-templates` (V4)                                                                        |
| `docs/SECURITY_DESIGN.md`                                                       | Section 8d (SEC-17) for V3. For V4: SEC-4, SEC-8, SEC-13 and SEC-14 each state what holds in the compact topology     |
| `docs/ARCHITECTURE.md`, `docs/deploy.md`, `docs/operations.md`, `docs/PORTS.md` | The compact topology, its variables and its second listener (V4)                                                      |

## Security

- [ ] Input validation: no new input enters the system. V2 changes how a stored stamp selects an implementation; an unknown stamp is refused exactly as today. V3 is test-only. V4 delivers the same requests by a different transport.
- [ ] Authentication / authorisation: unchanged checks. V3 makes "which admin reads the agent may make" a reviewed list in both directions. In V4 an in-memory request still carries the internal token and the admin session and still passes the API's own middleware and route policy, so no check is skipped by removing the hop.
- [ ] SQL / injection: N/A. No query is added or changed.
- [ ] XSS: N/A. No rendered output changes.
- [ ] Secrets: V4 is the one change. In the compact topology the process serving the admin also holds every secret the API holds. That is the ADR-35 exception Q4 asks for, and SEC-8's inventory records it. The default topology is unchanged. No secret is added.
- [ ] Dependency risk: none added. The combined image carries the union of the two existing dependency sets and is scanned by `pnpm qcms:scan-images` like the other three.
- [ ] Data exposure: V2 keeps the rule that evaluator messages name ids and never answer values. V3's table is where a route returning answer values is recorded as unmirrored. V4 must keep SEC-13 with one telemetry SDK in the process: the redaction that covers the API's spans and logs and the redaction that covers Next.js spans both apply, and a test proves a known answer value reaches no exported payload.

## Implementation steps

Size: S under a day, M two to three days, L a week or more. Tier: F Fable, O Opus, S Sonnet. Each row is one branch and one PR unless its steps say otherwise, and takes a work-order number when scheduled.

| ID  | Task                                                                                                           | Deps | Size | Tier            |
| --- | -------------------------------------------------------------------------------------------------------------- | ---- | ---- | --------------- |
| V1  | Decision bundle: Q1 to Q4 ruled, then the ADR-18 Note, `docs/a2ui-mapping.md` statement and the phase-4 sketch | none | S    | F               |
| V2  | Evaluator dispatch by semantics version, per-version golden runner, `CORPUS.md` rule, ADR-16 Note              | Q1   | M    | O, Fable review |
| V3  | Route-to-tool coverage in the agent parity audit                                                               | none | S    | O, Fable review |
| V4  | Compact topology: portal plus one combined admin and API process, opt-in                                       | Q4   | L    | O, Fable review |

- [ ] **Step 1 - V1 decision bundle**
  - Put Q1 to Q4 to the Code Owner with the evidence above.
  - Write only what is ruled: the ADR-18 Note and `docs/a2ui-mapping.md` statement (Q2), the item 5 sketch in `docs/features/039-phase4-backlog.md` (Q3), the scheduling of V2 (Q1). The ADR-35 amendment (Q4) lands with V4's own PR, not here.
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

- [ ] **Step 6 - V4 spike, on a branch that is not merged**
  - Prove, with the real builds, that one Node process can run the admin's standalone server and the API together: both listeners bind, a server component and a route handler both see the hook, a streamed response (the export download and the assistant's event stream) passes through intact, one telemetry SDK exports both sets of spans, and `SIGTERM` exits cleanly.
  - Try the parent-entry composition first and the `register()` composition second.
  - Acceptance: a written result on the issue naming the composition that works and what it needed. If neither works without patching Next.js, V4 stops here and Q4 goes back to the Code Owner.

- [ ] **Step 7 - V4 start function and dispatch seam**
  - Split `apps/api/src/main.ts`; add `apps/admin/lib/server/embedded-api.ts` and the branch in `loggedFetch`; extend the import-surface test.
  - Acceptance: with no hook present every existing admin and API test passes untouched, so the default topology is provably unchanged; with a stub hook no network call is made and the request the hook receives is identical in method, path, headers and body.

- [ ] **Step 8 - V4 combined entry, image and Compose variant**
  - Add the combined entry, `docker/admin-api.Dockerfile`, `docker-compose.compact.yml`, the telemetry changes and the single shutdown path; allocate the second listener's port in `docs/PORTS.md`.
  - Acceptance: `docker compose -f docker-compose.compact.yml up` reaches healthy with three containers; the API listener is not published; `pnpm qcms:scan-images` passes for the new image.

- [ ] **Step 9 - V4 verification and records**
  - Run the full-stack flow against the compact stack; add the trace and redaction test; write the ADR-35 amendment, the ADR-20 Note, the SEC-4, SEC-8, SEC-13 and SEC-14 statements and the deploy and operations pages; regenerate the scaffold templates.
  - Acceptance: the full-stack flow passes on both stacks; one respondent action and one admin action each produce one connected trace on the compact stack; a known answer value appears in no exported payload; `pnpm check:templates` passes.

## Testing plan

### Unit tests

| Subject                        | Cases to cover                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEvaluator(table)`       | routes a stamp to its implementation; two versions in one table reach different implementations; unknown stamp is a typed error; bare definition uses the current version                                                                                      |
| `evaluateRules()`              | every existing case in `evaluate-rules.test.ts` and `prepare-submission.test.ts` passes without edits                                                                                                                                                          |
| `SUPPORTED_SEMANTICS_VERSIONS` | contains `SEMANTICS_VERSION`; is sorted and frozen                                                                                                                                                                                                             |
| Golden runner                  | default version is `1`; a declared version is honoured; an unregistered declared version fails by name                                                                                                                                                         |
| Route-to-tool coverage         | every GET row is in `TOOL_ROUTES` or the unmirrored table; no path is in both; every reason is in the closed set; an open gap names an issue                                                                                                                   |
| `loggedFetch` with the hook    | hook absent uses `fetch`; hook present makes no network call; internal token, session, environment and request id headers arrive unchanged; `Set-Cookie` on an auth response is returned unchanged; a streamed body is not buffered; `traceparent` is injected |
| API start function             | starts and stops cleanly twice in one process; schedulers start only when the internal surface is mounted; stop ends the pools                                                                                                                                 |
| Admin import surface           | no admin source file imports `qcms-api`, `pg`, `drizzle-orm`, `@roonga/qcms-db` or `better-auth`                                                                                                                                                               |

Files: `packages/core/src/semantics/registry.test.ts`, `packages/core/src/golden-corpus.test.ts`, `apps/api/src/features/agent/parity.test.ts`, `apps/admin/lib/server/embedded-api.test.ts`, `apps/admin/lib/server/r2-import-surface.test.ts`

### Component tests

N/A. No React component, control or rendered document changes in any step.

### E2E tests

V2 and V3 add no scenario. They change no behaviour, so the proof is that the existing suites pass unmodified:

- [ ] `apps/api/e2e` scenario suite and `apps/api/e2e/security/matrix-coverage.e2e.ts`
- [ ] The full-stack flow in `apps/e2e/full-stack-conditional-form.pw.ts`, through `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`, once after V2

V4 adds the compact stack as a second target for flows that already exist:

- [ ] An author signs in with two-factor, publishes and releases a form, a respondent completes it through the portal, and the export and the signed webhook arrive, all on the compact stack
- [ ] The assistant's event stream and the response export download complete on the compact stack
- [ ] Error path: with the API listener unreachable from the portal, the portal shows its existing failure screen and the admin keeps working
- [ ] One respondent action and one admin action each produce one connected trace, and a known submitted answer value appears in no exported span or log

Files: `apps/e2e/full-stack-conditional-form.pw.ts` run against `docker-compose.compact.yml`, and a trace test beside `apps/portal/e2e/otel-trace.pw.ts` and `apps/admin/e2e/otel-logs.pw.ts`

### Axe / accessibility

N/A. No interactive component is added or changed, so no axe gate has new input. Task 030's manual pass is unaffected.

## Static code analysis

All checks must be green before a step merges.

- [ ] `pnpm verify` on V2, V3 and V4: the full merge gate, which includes `check:all`, build, typecheck, lint, test and `test:golden-drift`
- [ ] `pnpm check:plan` on V1, which stays on the instruction and plan fast lane
- [ ] `pnpm check:golden-append-only` on V2: no scenario, form or question file under `packages/core/golden/evaluator/` modified
- [ ] `QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached` on V4, because it touches `apps/admin`
- [ ] `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` on V4, on the default stack and on the compact stack, never both at once on one seat
- [ ] `pnpm check:templates`, `pnpm check:ports`, `pnpm check:docker-job-guards` and `pnpm check:ci-parity` on V4
- [ ] `pnpm check:comments` and `pnpm check:no-em-dash` on every step

## Definition of done

- [ ] Q1 to Q4 each carry a recorded Code Owner ruling
- [ ] Every implementation step above is checked off
- [ ] All listed unit tests are written and passing, and the existing suites pass without edits
- [ ] The default topology is unchanged: `docker-compose.yml` and its full-stack run are as they were
- [ ] All static analysis checks are green
- [ ] A changeset is added for `@roonga/qcms-core`
- [ ] Each PR has an independent review with an `AGENT-REVIEW: APPROVE` verdict at its current head, a Fable first review on V2, V3 and V4, and green CI

## Not in this plan

Line counts are non-test source at the baseline.

| Change from the review                                                            | Why it is left out                                                                                                                                                          | What would reopen it                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Removing the BFF layers, with the admin served by the API as a client application | Rewrites how every admin page loads its data. The proxy layers are about 7,000 of the admin's 56,000 lines, so the saving is small. V4 gets the operational gain without it | A rewrite                                                                          |
| Portal and API in one process                                                     | Puts database credentials in the internet-facing process                                                                                                                    | None foreseen                                                                      |
| All three in one process                                                          | Admin routes must not exist in the public process (ADR-09)                                                                                                                  | None foreseen                                                                      |
| Dropping the stored compiled documents                                            | Reverses ADR-01 and ADR-18 and touches about 65 source files across nine packages and apps                                                                                  | A Code Owner ruling before launch; not recommended now                             |
| One control set in the portal, so nothing is swapped at hydration                 | Restructures `apps/portal/components/step-flow.tsx` (929 lines) and repeats the portal accessibility evidence, including task 030                                           | Measured loss of respondent input on a throttled device                            |
| One session event log in place of the answer and roster ledgers                   | Rewrites the most audited tables for a modest gain                                                                                                                          | None foreseen                                                                      |
| Grants stored outside the better-auth organisation tables                         | better-auth is imported in six API files and QCMS's own resolver already decides every grant; the gain is coupling, not behaviour                                           | A better-auth upgrade that breaks the plugin tables, or the C1 to C3 identity work |
| Environments by row-level security                                                | Schema grants are the stronger isolation for deployments holding personal data                                                                                              | None foreseen                                                                      |
| Shipping an image with extension points in place of scaffolded source             | A product decision (ADR-05), not an engineering one                                                                                                                         | The Code Owner                                                                     |
| Generating agent tools from route definitions                                     | Tool output schemas are deliberately narrower than route responses, and task 096 with V3 gives the drift protection without it                                              | None foreseen                                                                      |
| A decimal answer type                                                             | The Code Owner ruled a decimal-place limit on `number` (issue #1293, `docs/adr/proposals.md`), which covers the money case without a new type                               | None foreseen                                                                      |

## Sources

Checked 2026-11-23.

- A2UI 1.0 protocol specification: https://a2ui.org/specification/v1.0-a2ui/
- A2UI 1.0 release announcement: https://developers.googleblog.com/en/a2ui-10-build-delightful-fast-reliable-agentic-experiences/
- MCP elicitation, form mode: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- MCP Apps extension: https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Structured outputs and their JSON Schema limits: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- `@a2ra/core` registry listing: `npm view @a2ra/core dist-tags versions`
- Next.js standalone output and its `server.js`: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js custom server, which cannot be combined with standalone output: https://nextjs.org/docs/app/guides/custom-server
