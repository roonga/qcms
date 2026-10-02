---
"@roonga/qcms-csv": minor
---

Add `zipStream`, a streaming ZIP container for multi-file exports (task 075, ruling Q17).

The long CSV shape of a form with a repeating group is more than one file - `responses.csv`
for every question outside a group, plus one file per group at the group's own grain - so it
downloads as a zip. This package already owns the export's byte-level encoding (RFC 4180
fields and the spreadsheet formula-injection guard), so the container sits beside them rather
than becoming a second place export bytes are decided.

- **Fetch-pure** (R4): a web `ReadableStream`, no `node:zlib` and no `node:stream`.
- **Streaming**: entries are stored (method 0) with general-purpose flag bit 3 and a data
  descriptor after each entry's bytes, so nothing is buffered and the caller can make each
  entry its own pass over a paged query. An entry's content is only pulled once the previous
  entry is written.
- **Deterministic**: every entry takes a fixed DOS timestamp, so two archives of the same data
  are byte-identical and a golden test can assert bytes.
- **Bounded, and checked**: the archive is plain, not ZIP64, so no entry and no archive may
  reach 4 GiB and an archive holds at most 65,535 entries. Exceeding either raises rather than
  emitting a truncated archive a reader would misparse.
