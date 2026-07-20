# The step-resolver seam (`@qcms/a2ui-compiler`, task 011)

The A2UI compiler is the project's **reserved agent seam** (ARCHITECTURE §12,
ADR-01/14). Today it is a pure, deterministic projection from a published
`FrozenSnapshot` to A2UI documents; the seam keeps a Phase-4 agent/adaptive
resolver "a feature away, not a migration away" without changing the launch
contract.

This document defines the seam interface, its launch implementation, and how a
substitute (an adaptive resolver, or a test double) plugs in.

## The interface

```ts
interface StepResolverContext {
  readonly snapshot: FrozenSnapshot; // the published snapshot being compiled
  readonly locale: LocaleCode; // active locale (options.locale ?? defaultLocale)
  readonly resolveText: (text: LocalizedText) => string;
  readonly resolveQuestion: (ref: QuestionRef) => QuestionDefinition;
  readonly isFirstStep: boolean; // only the first step emits the form-title h1
}

interface StepResolver {
  readonly resolveStep: (step: Step, context: StepResolverContext) => A2UIDocument;
}
```

`compileForm` owns the whole-form concerns — locale resolution, pin-to-question
resolution, per-step context assembly, and the version stamps — and delegates
the **projection of one step to one document** to a `StepResolver`. A resolver
does no I/O and no lookups of its own; everything it needs is passed in through
the context (the kernel's R3 discipline, applied to the compiler).

## The launch implementation: `staticStepResolver`

The default resolver is a deterministic projection of the pinned domain model
(the mapping is specified in [`a2ui-mapping.md`](./a2ui-mapping.md)):

- root `Form → Flex(direction: "column")`;
- form title as `Text(as: "h1")` on the first step, step title as
  `Text(as: "h2")` on every step (the page heading outline);
- one control node per pinned question, with `label`/`description`/`name` and
  advisory constraint hints, and the `errorMessage` slot left unset for the
  renderer (028) to fill.

`compileForm(snapshot, options)` is exactly
`compileFormWith(staticStepResolver, snapshot, options)`.

## Substituting a resolver

`compileFormWith(resolver, snapshot, options)` is the seam entry point: pass any
`StepResolver` and every step routes through it. Two intended substitutes:

1. **A Phase-4 adaptive/agent resolver** (out of scope now, R7). It would
   implement `resolveStep` to branch on prior answers — producing documents that
   respond to what a respondent has already entered. Note the seam is
   **authoring/compile-time**: agents assist authoring only (ADR-25); the
   serving path serves the stored document and never sees an LLM (ADR-18). A
   richer context (threading answers) is a forward-compatible extension of
   `StepResolverContext`.

2. **A stub test double.** A trivial resolver used to prove the swap point
   without exercising the full mapping. From `compile.test.ts`:

   ```ts
   const stub: StepResolver = {
     resolveStep: (step) => ({
       stepId: step.stepId,
       root: { type: "Text", props: { as: "h2" }, children: `stub:${step.stepId}` },
     }),
   };
   const compiled = compileFormWith(stub, snapshot, {});
   // every document now comes from the stub; version stamps still come from the compiler
   ```

## Invariants a substitute must preserve

- **One document per step, keyed by `stepId`, in form order.** `compileForm`
  drives the iteration; a resolver returns exactly one `A2UIDocument` per call.
- **Spec conformance.** Every emitted document must validate against the pinned
  `@a2ra/core` Zod schemas (`a2uiSpecVersion`) — the compiler stamps the version;
  the renderer keeps backward compatibility with every version ever published,
  enforced by the append-only golden corpus (012, ADR-18).
- **Determinism** for any non-adaptive resolver: the same snapshot and options
  produce structurally identical output.
- **No new runtime dependencies.** The compiler runtime stays React-free and
  never imports `@a2ra/*` at runtime, the db, or Node built-ins (enforced by the
  `no-restricted-imports` block in the root `eslint.config.js`).
