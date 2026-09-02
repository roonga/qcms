---
"@qcms/ui": minor
---

Export `toVSafePattern` and `compilesUnderV` from the package root (issue #53).

Both already existed as the renderer's internal `pattern` normalization (issue
#29): browsers compile the HTML `pattern` attribute under the regex `v` flag,
whose character-class grammar is stricter than the `u` semantics a question's
validation regex is authored against, so the renderer rewrites such a pattern
where the rewrite is provably meaning-preserving and omits the attribute where
it is not.

Exporting them lets an authoring surface offer the same rewrite as a suggestion,
so an author can store a pattern that needs no repair rather than having every
render repair the same string. Behaviour is unchanged: this adds two names to
the public surface and nothing else. The renderer stays the primary caller,
because stored A2UI documents are immutable and keep their original pattern
whatever an author does next (R1, ADR-18).
