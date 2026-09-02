---
"@qcms/db": minor
---

Give both hourly retention sweeps a supporting index, after measuring what they cost without
one (issue #434).

Minor rather than patch: this adds two indexes and a migration (`0018_retention_sweep_indexes`)
to the package-owned history, so an adopter's `drizzle-kit migrate` does real work on upgrade
and the schema an adopter sees changes. No query, no column and no behaviour changes, and
nothing existing moves.

`redactAgedOutboxPayloads` and `redactAgedResponseSnippets` were both correct and both
unsupported: every hourly pass read its whole table. The issue asked for the measurement
before the index, because a partial or expression index is a schema decision with a real
write-path cost and guessing between the candidates is how a performance fix becomes a write
regression.

**The measurement's most useful finding was a negative one.** The two obvious candidates - a
bare expression index on `greatest(delivered_at, dead_lettered_at)` for the outbox, and a bare
`(last_attempt_at)` for the deliveries, which are the shapes the issue proposes first - were
built and measured at 10k, 100k and 1M rows, and the planner **never chose either at any
scale**. Neither can exclude the rows a previous pass already redacted, so the estimated row
count stays near the table size and a sequential scan always wins. What makes each index usable
is the partial predicate mirroring the sweep's own filters. Both shipped indexes therefore
carry one, which is also what keeps them small: they cover only the rows still awaiting a
sweep, so they shrink as the sweep does its job.

At 1M rows the snippet sweep goes from a sequential scan reading 59,097 blocks to a bitmap
index scan reading 24, and the outbox side of the payload sweep's plan drops from 246,668
blocks to 63. The milliseconds are not the point at an hourly cadence; the blocks are, because
each unindexed pass pulled a 315 MB or 2.1 GB table through `shared_buffers` and evicted the
serving working set. Steady-state index sizes are 744 kB and 3.5 MB, around 0.17% of their
tables.

The write-amplification worry the issue raises does not survive contact with the write path
QCMS actually has. On a bulk 50k insert the outbox index costs +65%, but the outbox is written
one row per submission: isolated with `synchronous_commit=off` over 5000 samples it adds about
21 microseconds, against a ~4 ms durable commit. The delivery-side write path showed no
measurable cost at all.

One limit is worth stating rather than discovering later: **the outbox index removes that
sweep's table scan without making the sweep cheap.** Its correlated `NOT EXISTS` still
hash-anti-joins the whole `webhook_deliveries` table, which is 150 ms of the remaining 182 ms
at 1M rows, and no index closes that - a forced nested loop reaches 12 ms using the index that
table already has, so what is left is a planner cost-model choice. Restructuring the query, or
bounding the sweep, is a separate decision.
