---
"@roonga/qcms-db": patch
---

Re-point the better-auth citations in the `control` auth mirror at 1.7.10.
Comments only: the mirror's tables, columns and indexes are unchanged, because
1.7.8 through 1.7.10 change nothing about which columns better-auth writes.
`@better-auth/drizzle-adapter`'s schema-check chunk is content-hash named and
1.7.8 prepended a date-column region to it, so `introspectDrizzleSchema` is now
`dist/schema-check-Dqk6A4Es.mjs:121-136`; the function itself is byte-identical,
so what the library's check reads is still `notNull` and `hasDefault` and
nothing else.
