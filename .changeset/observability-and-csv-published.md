---
"@qcms/observability": minor
"@qcms/csv": minor
---

Publish `@qcms/observability` and `@qcms/csv`.

Both were private workspace packages, and all three applications depend on them at
runtime: the redacting logger and the SEC-13 allowlists in one, the RFC 4180 quoting
and the spreadsheet formula-injection guard (issue #470) in the other. A project
scaffolded by `create-qcms-app` receives those applications and no workspace, so a
`workspace:*` range for either one is a range nothing can install.

They are versioned packages rather than scaffolded source deliberately. Both carry a
security control that an upgrade should be able to correct everywhere at once, which
is exactly the line ADR-05 draws: an adopter owns the code they would reasonably
change, and depends on the code whose modification would cost an audit guarantee.
