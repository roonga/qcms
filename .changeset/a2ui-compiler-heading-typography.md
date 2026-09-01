---
"@qcms/a2ui-compiler": minor
---

Emit `size` and `weight` on every compiled heading, so a form title and a step title stop
rendering as body copy (issue #186).

`heading()` set only `as`, and the vendored `Text` component defaults `size` to `md` and
`weight` to `normal`. So the form-title `h1` and the step-title `h2` in every compiled step
rendered at 16px, normal weight, in the body text colour - typographically identical to the
question labels and hint text beside them. The elements and their order were always
correct, which is why nothing caught it: axe checks that a heading IS a heading, not that
it LOOKS like one, so every gate stayed green while a sighted respondent got no visual
answer to "where am I in this form".

The mapping is now `h1 -> size: "2xl", weight: "bold"` and `h2 -> size: "xl", weight:
"semibold"`, both from the `Text` schema's own enums. Stating the intent in the stored
document rather than relying on a renderer default is the point: the compiled bytes are
served forever (ADR-18), so a renderer that later changed its defaults would silently
restyle every published form, and a renderer that is not ours has nothing to read the
intent from at all.

This changes existing compiled output, so under the append-only golden policy (ADR-18) it
is a new generation: `COMPILER_VERSION` bumps `0.1.0 -> 0.2.0`, the corpus runner targets
the new `golden/v3/`, and `golden/v1/` and `golden/v2/` are retained untouched as the
record of what `0.0.0` and `0.1.0` produced (still asserted spec-valid, and each still
asserted to lack the property that made its successor a generation). No stored snapshot
changes: a published version is served from its own bytes and is never recompiled. See
`packages/a2ui-compiler/golden/README.md` and `docs/a2ui-mapping.md`.

The `--type-step-title` theme token still has no consumer inside the renderer. Pointing the
sizes at theme tokens would mean editing the vendored `Text` component, which is a
byte-for-byte upstream copy (ADR-22), so that half of #186 is deliberately left out of this
change.
