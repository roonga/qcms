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
- **Streaming, with demand propagated per chunk**: entries are stored (method 0) with
  general-purpose flag bit 3 and a data descriptor after each entry's bytes, which is what
  lets an entry be written without knowing its size first. The memory bound is that the
  writer does **one unit of work per `pull`** and a `pull` takes at most one chunk, so what
  it holds is one chunk, the open entry's name, and one 46-byte record per entry already
  written. That matters because `controller.enqueue` never blocks and a `ReadableStream`
  applies backpressure only by withholding the next `pull`, so a writer that walked a whole
  entry per `pull` would queue the whole file regardless of demand. A unit test reads one
  chunk, waits, and asserts the producer advanced by one.
- An entry's content is only asked for once the previous entry is closed, so a caller can
  make each entry its own pass over a paged query without ever holding two of them.
- **Deterministic**: every entry takes a fixed DOS timestamp, so two archives of the same data
  are byte-identical and a golden test can assert bytes.
- **Bounded, and checked**: the archive is plain, not ZIP64, so no entry and no archive may
  reach 4 GiB and an archive holds at most 65,535 entries. Exceeding either raises rather than
  emitting a truncated archive a reader would misparse.
