---
"@qcms/db": minor
---

Add reporting-view read helpers for the data-out admin surface (023):
`listResponses` (paginated, filterable by version/date/flag), `getResponse`
(one response's detail with content hash), `fetchResponsePage` (keyset pages for
memory-bounded export streaming), `listTombstones` (erasure compliance
evidence), and `clearSubmissionFlag` (a race-safe, idempotent release of a
withheld submission's flag). All response reads go through `reporting.responses`,
so erased and non-submitted sessions are excluded by construction (the tombstone
anti-join) — no read path can bypass the exclusion.
