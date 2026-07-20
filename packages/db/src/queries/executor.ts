import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

import type * as schema from "../schema/index.js";

/**
 * The transaction/connection handle every query helper takes as its **first
 * argument** so the calling slice - never the helper - owns transaction
 * boundaries (R3: slices load state, pass it to the kernel, persist results).
 *
 * `PgDatabase<…>` is the common supertype of both the top-level Drizzle handle
 * (`NodePgDatabase`) and a transaction handle (`PgTransaction`), so a helper
 * typed against it accepts either: call it standalone (each statement is its
 * own transaction) or inside a `db.transaction(async (tx) => …)` the caller
 * opened. `.NET` mapping: like accepting a `DbConnection` or an open
 * `DbTransaction` interchangeably.
 */
export type Executor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
