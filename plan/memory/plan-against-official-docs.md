---
name: plan-against-official-docs
description: "Code Owner directive - plans, ADRs and task files leaning on external tech are verified against official docs, registry and source at drafting time, never written from memory"
metadata:
  node_type: memory
  type: feedback
---

Code Owner directive (2026-07-29), codified as a Ground rule in `plan/CLAUDE.md`: when a plan, ADR draft, or task file leans on external tech (library, framework, protocol, tooling), check the official documentation, the package registry, and where the claim is load-bearing the source, before presenting it. Prefer the vendor's documented setup path over hand-rolled equivalents, and name the sources and versions checked in the artifact. When the check contradicts the draft, the draft changes.

**Why:** the observability plan's first draft sketched hand-rolled OpenTelemetry wiring. The Code Owner redirected to the official OTel JS setup, and verifying against the Next.js OTel guide and the `@hono/otel` source then caught real errors the draft would have shipped: portal fetch double-instrumentation, the `propagateContextUrls` requirement, and the OTLP exporter's localhost default breaking the no-op-by-default principle. Precedent is `plan/observability-plan.md` revs 2 and 3.

**How to apply:** before finalizing any externally-dependent recommendation, fetch and read the official guide (in the current harness, the WebFetch tool), query the registry for the real current version (`pnpm view <pkg>` - bare `npm view` is denied by the pnpm-only permission rules), and read the source for any load-bearing claim (for instance: does the middleware actually extract `traceparent`). Fold contradictions back into the draft and record the rev. The requirement is that the check happened and is cited; which tool performed the fetch is incidental.

Related: [[pm-delegation-and-routing]], [[code-owner-preferences]].
