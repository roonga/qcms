---
"@qcms/ui": minor
---

Add an opt-in native (no-JS) submit mode to `A2UIStepRenderer` (task 044). Passing
the new `nativeSubmit` prop (`{ action, submitLabel, submitClassName? }`) renders
the step as a real `<form method="post" action=...>`: the react-aria controls
render uncontrolled (a `defaultValue` seeded from `values`, no `onChange`) so the
browser's own form serialization carries each answer keyed by its questionId, a
real `<button type="submit">` (the new render-time-only `SubmitButton` node) POSTs
the step, and a hidden kind-tag input per answer (`__qk__<questionId>`) lets a
strict BFF decode the wire string back to the canonical shape without knowing the
question. The honeypot decoy (026) rides inside the form, still AT-invisible.

The submittability is a render-time capability only: the stored compiled document
is never mutated (ADR-18). The default (controlled) path is unchanged - the 028
conformance snapshots and the 030 questionId-keyed focus handle are undisturbed.

New public exports: `withNativeSubmit`, `NATIVE_FIELD_KIND_PREFIX`,
`SUBMIT_NODE_TYPE`, and the `NativeSubmitOptions` / `NativeFieldKind` types.
