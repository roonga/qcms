---
"@qcms/a2ui-compiler": minor
---

Emit a visually-hidden honeypot decoy in every compiled step document (abuse
controls, task 026). Each step's `Form → Flex(column)` now ends with a dedicated
`Honeypot` node (`name: "website"`, `autoComplete: "off"`, `ariaHidden: true`,
`tabIndex: -1`) that a real respondent never reaches but a blind form-filler
trips - the submit slice (020) then silently flags the session. New public
exports: `HONEYPOT_FIELD_NAME`, `HONEYPOT_NODE_TYPE`, `honeypotNode`.

This changes existing compiled output, so under the append-only golden policy
(ADR-18) it is a new generation: `COMPILER_VERSION` bumps `0.0.0 → 0.1.0`, the
current goldens move to `golden/v2/`, and `golden/v1/` is retained untouched as
the record of what `0.0.0` produced (still asserted a valid `@a2ra/core`
document). See `packages/a2ui-compiler/golden/README.md` and
`docs/a2ui-mapping.md`.
