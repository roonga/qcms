---
"@roonga/qcms-core": minor
---

`compileDraft` gains a warning channel and two publish checks (issues #123, #53,
#366).

**Changed success shape.** `PublishResult` is now
`Result<{ snapshot, warnings }, readonly PublishError[]>` rather than
`Result<FrozenSnapshot, readonly PublishError[]>`. The frozen snapshot moves one
level down, to `result.value.snapshot`, and `result.value.warnings` carries the
non-blocking advisories the same compile raised. The error branch is unchanged.
This breaks any caller that reads `result.value` as a snapshot, and the fix is
mechanical: add `.snapshot`. It is a `minor` because the package is pre-1.0,
where minor is the breaking channel; the only callers in this repository are the
API's publish, validate and draft-save paths, which have been updated.

Warnings are strictly non-blocking. A warning never refuses a publish and is
only ever raised on a draft that produced a snapshot, so a result carrying
warnings always carries a snapshot too, and a caller that reads only the
snapshot behaves exactly as it did before.

**`MULTICHOICE_SAME_STEP_TARGET`** (issue #123): a rule whose condition reads a
multiChoice answer and whose target is a question on the same step. ADR-31
classifies multiChoice as committing on group exit rather than on change, so the
reveal cannot happen while the respondent is still inside the checkbox group; it
lands later than the author almost certainly intended. A cross-step target does
not warn, which is the point of the classification rather than an omission.

**`compilesUnderV` and `toVSafePattern`** (issues #52, #53): the authoring-time
half of the browser-compatibility rule for `pattern`. Browsers compile the HTML
`pattern` attribute with the `v` flag, whose character-class grammar is narrower
than the `u` semantics `checkSafePattern` validates against, so a pattern such as
`^[A-Za-z][A-Za-z .,'-]{0,99}$` is dropped by the browser and the field loses its
native hint. `toVSafePattern` returns an equivalent spelling when the rewrite is
provably meaning-preserving, the original when a browser already accepts it, and
`undefined` when neither holds. The API's question-authoring boundary uses these
to refuse a v-invalid pattern on a new or edited definition; `checkSafePattern`
is deliberately unchanged, because it also parses every stored definition, seed
fixture and golden-corpus input, and refusing there would retroactively
invalidate published content (R1) and change what the append-only corpus compiles
(ADR-18).

**`PATTERN_CLASS_SET_AMBIGUOUS`** (issue #53): a shortText `pattern` whose
character class carries an unescaped `&&` or `--`, where the pattern compiles
under both the `u` and the `v` regex flag. `[a&&b]` is `{a, &, b}` under `u` and
an empty-set intersection under `v`, with no console error and no compile
failure anywhere downstream, so authoring-time validation is the only layer that
can detect it. The new `classSetAmbiguity` export answers the same question on
its own.

**`BLANK_LOCALIZED_TEXT`** (issue #366): a publish error for any authored
`LocalizedText` value that is whitespace only, naming the question and the
locale, sitting beside the existing default-locale completeness check.
`LocalizedText` itself stays `z.string().min(1)` and is deliberately not
tightened to `.trim().min(1)`: published snapshots are re-parsed on the serving
path, so a type tightening would make an already-published form containing a
blank label fail to parse at serve time (R1). Every locale is checked, not only
the default.

The a2ui golden corpus is unaffected: no golden document changed, and the
corpus, the seed fixtures and the evaluator corpus all still compile.
