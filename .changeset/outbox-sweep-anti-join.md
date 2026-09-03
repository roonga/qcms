---
"@qcms/db": patch
---

The outbox payload retention sweep names its candidates instead of letting the planner guess (issue #781), and migration `0017_account_issuer` gets the snapshot it shipped without (issue #780).

**Patch, not minor, and the reason matters for an adopter reading this line.** Neither change alters the schema, a column, a migration's DDL, or which rows the sweep redacts: `redactAgedOutboxPayloads` returns the same `redactedCount` over the same rows, verified by running the old and new statements alternately against the same 1M-row database and comparing the row sets. What changes is that the sweep now issues two statements rather than one, and the snapshot chain in `migrations/meta/` is complete. `drizzle-kit migrate` does no work for either, so there is nothing for an adopter to apply.

The sweep's correlated `NOT EXISTS` was costed from a row estimate around 200x too high, because Postgres does not apply the partial expression index's statistics to `greatest(delivered_at, dead_lettered_at) < $1`. From that premise a hash anti-join over the whole `webhook_deliveries` table is genuinely cheaper, so it was chosen, and the hourly pass read that table end to end for work a candidate lookup does in under a millisecond. #434's indexes could not close it, because no index fixes an estimate. An explicit candidate id list does. Measured end to end at 1M outbox rows and 1M deliveries: 278.8 ms to 33.6 ms at 702 eligible rows, 330.7 ms to 82.3 ms at 1,258, 532.6 ms to 273.0 ms at 5,186. Above a measured 10,000-row budget the sweep issues exactly the statement it always did, which is the better plan for a backlog.
