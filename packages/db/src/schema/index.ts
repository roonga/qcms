/**
 * The Drizzle schema, in the two planes ADR-40 splits it into.
 *
 * - `./control/` is the **control plane**: one copy, in the `control` schema.
 * - `./data/` is the **data plane**: one copy per environment, in `data_<env>`,
 *   declared unqualified so the connection's `search_path` chooses the environment.
 *
 * Everything is re-exported flat from here, so `import { forms, sessions } from
 * "@roonga/qcms-db"` is unchanged by the split and no caller has to know which plane a
 * table is in. The two index modules are what the generator, the per-schema table lists
 * in `migrations.test.ts` and the disjointness check read.
 */

export * from "./control/index.js";
export * from "./data/index.js";
