/**
 * Apply the package-owned migration history to a configured database.
 *
 * This is intentionally a separate, explicit process. Application containers
 * never migrate on boot: in a multi-instance deployment that would make schema
 * changes race with rollout, and it removes the operator's control of upgrades.
 */
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  process.stderr.write("qcms-db migrate failed: DATABASE_URL is required\n");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  process.stdout.write("qcms-db migrations applied\n");
} finally {
  await pool.end();
}
