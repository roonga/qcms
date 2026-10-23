# Workflow improvement backlog

Keep only unresolved, recurring workflow friction here. Once an item is fixed, moved to an issue, or no longer relevant, delete it. Git history is the audit trail.

## Open items

- A docs-only lane on a native Windows checkout cannot run `pnpm check:plan` to the end: `vendor-cite` stops first because it cannot read `@better-auth/drizzle-adapter` from `node_modules`, so the prettier and eslint halves have to be run by hand (#1120). A `check:plan:docs` script that skips the vendor and schema steps would close it.
