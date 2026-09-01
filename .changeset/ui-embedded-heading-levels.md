---
"@qcms/ui": minor
---

Add `headingLevelOffset` to `A2UIStepRenderer`, plus the `withDemotedHeadings` transform
behind it, so a host that EMBEDS a compiled document in a page that already has an `<h1>`
gets one document outline instead of two (issue #537).

A compiled step carries the outline it would have as a whole page: the form title as `h1`
on the first step, the step title as `h2` on every step. That is right on the portal, where
the document IS the page. The admin's version view renders the same document inside a page
whose own `<h1>` names the version, so `/forms/{id}/versions/{v}` had two top-level
headings - a document-outline defect for anyone navigating by heading level, and an
ambiguous `getByRole("heading", { level: 1 })` for anything testing the route. The draft
preview embeds the same way and shared it.

The renderer yields rather than the host chrome, because the stored document is immutable
content served for the life of the snapshot (R1, ADR-18) and cannot know what page it will
appear inside. The transform is render-time only, exactly as `withNativeSubmit` and
`documentForVisible` already are, and moves only the `as` prop: `size`, `weight` and colour
are left as compiled, so an embed still shows what a respondent saw. Levels clamp at `h4`,
the deepest the `Text` schema accepts.

Additive and defaulted off, so the portal's rendering is byte-identical to before.
