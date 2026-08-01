# 048 - Author-supplied validation messages (ADR-32) and boolean label overrides (ADR-36)

**Stage:** 8a · **Apps/packages:** `@qcms/core` · `@qcms/a2ui-compiler` · `apps/api` · `apps/portal` · `apps/admin` · **Depends on:** 032 (question editor)
**References:** ADR-32 and ADR-36 (this task implements both) · ADR-11 (LocalizedText) · ADR-18 (compiled doc seam) · ADR-27 (no hardcoded user-facing text) · ADR-31 (commitment/reveal cadence unaffected) · R2, R6 · folds issue #22 · WCAG 3.3.1 (with #21's distinctness fix as the baseline)

## Context

Authors know their domain's wording; the portal's defaults are deliberately generic. ADR-32 adds optional per-question, per-constraint messages with inherit-by-default fallback surfaced in the editor. Messages are presentation payload: the kernel/API stay the validation authority and keep emitting stable error codes.

ADR-36 (Code Owner call, 2026-08-01) applies the identical mechanism to the boolean question's displayed labels: optional `yesLabel`/`noLabel` `LocalizedText` fields, each independently falling back to the compiler's `BOOLEAN_AFFIRMATION` lexicon. Wire values (`true`/`false`), answer semantics, rules, exports: all untouched - presentation payload only. Both features ride one task because they are the same seam end to end (kernel additive schema, compiler forwarding + golden append, editor placeholder-inherit fields, portal doc-driven rendering).

## Deliverables

- **`@qcms/core`:** optional `messages` map on the question definition (constraint key -> `LocalizedText`), additive-optional so existing stored content parses unchanged; versioned with the question (R6). Publish validation rejects messages for constraints the question does not carry.
- **`@qcms/a2ui-compiler`:** forward messages onto the control node as an optional prop. Existing golden corpus byte-stable; one NEW corpus entry exercising custom messages APPENDED (never edit existing entries).
- **`apps/api`:** no behavioral change - validation error codes unchanged; assert in a regression test that responses are byte-identical for content without messages.
- **`apps/portal`:** per-field error and error-summary rendering resolve author message (locale-picked, ADR-11) else default catalog. Error-summary composition stays label-anchored so accessible names remain distinct when two questions carry identical custom text (extend #21's Playwright spec with exactly that case).
- **`apps/admin` (032's editor):** per-constraint message fields with the default message as placeholder; blank = inherit (the ADR's edit-level fallback). Localized input per the form's locales.
- **Boolean label overrides (ADR-36), same pattern at every layer:** kernel - optional `yesLabel`/`noLabel` `LocalizedText` on the boolean definition, additive, versioned (R6); compiler - each label resolves author override else the `BOOLEAN_AFFIRMATION` lexicon entry for the locale (per-label fallback: overriding one leaves the other on the lexicon), existing goldens byte-stable, one appended corpus entry with overridden labels; editor - two optional fields on boolean questions, lexicon default as placeholder, blank = inherit; portal - no code change expected (labels arrive in the compiled doc as today). Update `docs/a2ui-mapping.md`'s lexicon note in the same change (staleness rule).

## Exit criteria

1. Kernel: schema additive; content without messages round-trips byte-identically; publish rejects orphan message keys (test).
2. Compiler: existing goldens byte-identical; appended corpus entry carries the messages prop (golden-append-only gate green).
3. Portal: custom message renders for each constraint type with fallback proven per-constraint; the identical-custom-messages case keeps distinct error-summary accessible names in the browser tree (Playwright).
4. Editor: placeholder-shows-default verified; blank inherits; non-blank overrides; axe pass on the editor fields.
5. Boolean labels (ADR-36): kernel schema additive with byte-identical round-trip for content without overrides; compiler goldens byte-stable plus one appended override entry; a portal render proves an overridden label pair and a mixed pair (one overridden, one lexicon); editor fields follow the same placeholder/inherit/axe checks as the message fields; wire values asserted unchanged under override.
6. `pnpm verify` + `verify:browser` green; screenshot gate for the editor fields (messages and boolean labels) and one portal error state.

## Out of scope (binding)

Per-form or deployment-wide message overrides; rich text or HTML in messages; changing any default catalog wording; new validation constraint types; retrofitting messages into existing fixtures (append a new one instead); label overrides for any non-boolean system furniture (Continue/Back/Submit stay lexicon/catalog-owned); new locales in the `BOOLEAN_AFFIRMATION` lexicon (R7: Phase 4).
