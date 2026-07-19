# 012 — A2UI golden corpus and append-only policy

**Stage:** 4 · **Package:** `@qcms/a2ui-compiler` · **Depends on:** 011
**References:** **ADR-18** · `IMPLEMENTATION_PLAN.md` Stage 4 · risk register #3

## Context

The golden documents are three things at once: the compiler's regression suite, the renderer's conformance input (028), and the audit contract between this project and `a2-react-aria`. Per ADR-18 the corpus is **append-only**: a golden document, once committed, is never deleted or edited — breaking A2UI changes add documents under a new spec version.

## Deliverables

- `packages/a2ui-compiler/golden/v1/` — reviewed compiled output for: kitchen-sink (every type, every constraint variant), insurance, minimal, plus a constraints-heavy form and a deep-nesting-rules form (add these two as core fixtures if not present, coordinating with 004's fixture README).
- Corpus runner: recompile fixtures, deep-compare against goldens, readable diffs on failure.
- **Append-only CI guard**: a script that fails the build if any file under `golden/` is modified or deleted in a diff against the default branch (additions allowed). Wire into CI.
- `golden/README.md`: the policy, the procedure for a spec bump (new `v2/` directory, old documents remain and remain rendered), and the statement that this corpus is the renderer-compat contract for `a2-react-aria`.
- Seam conformance: the `StepResolver` stub double from 011 exercised by a test proving the interface is implementable without touching compiler internals.

## Exit criteria

1. All fixture compilations match goldens in CI.
2. Guard verified: a scratch commit editing a golden fails CI; an addition passes. (Verify once, revert.)
3. Changing the compiler's output shape in a scratch branch produces a failing diff naming the exact document and path.

## Out of scope

Renderer implementation (028), spec-v2 machinery (build it when a breaking change actually arrives).
