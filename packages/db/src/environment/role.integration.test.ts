import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";

import { createLoginRole } from "./role.js";

/**
 * Creating a login role, against a real Postgres (SEC-8; PR #1093's review, finding 2).
 *
 * Two properties, and each one needs a server to be worth anything:
 *
 *   - **the verifier authenticates.** This module computes the SCRAM-SHA-256 stored secret
 *     itself so the plaintext never reaches a logged statement, which is only an
 *     improvement if the derivation is right. A string test could not tell a correct
 *     verifier from a plausible one; a login can, and that is the assertion.
 *   - **a refused creation carries no credential.** The review reproduced
 *     `PASSWORD 'SUPERSECRETPW2'` on an operator's terminal, so the test runs as a role
 *     **without `CREATEROLE`** - the shape `qcms_migrate` actually ships in - and reads
 *     the thrown message. The previous case passed only because the harness is a
 *     superuser, which is exactly the hole this closes.
 */

const TIMEOUT_MS = 60_000;

let testDb: TestDb;
/** A connection holding no `CREATEROLE`, which is the documented migration credential's shape. */
let unprivileged: pg.Client;

/** A throwaway credential for a containerised role. Generated, never committed. */
function ephemeralPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uriFor(role: string, password: string): string {
  const uri = new URL(testDb.connectionUri);
  uri.username = role;
  uri.password = password;
  return uri.toString();
}

beforeAll(async () => {
  testDb = await startTestDb();
  const password = ephemeralPassword();
  // Deliberately no CREATEROLE: this is the attribute set `docker-compose.yml` gives
  // `qcms_migrate`, and the one the review's reproduction ran under.
  await testDb.db.execute(sql.raw(`CREATE ROLE probe_no_createrole LOGIN PASSWORD '${password}'`));
  unprivileged = testDb.register(
    new pg.Client({ connectionString: uriFor("probe_no_createrole", password) }),
    "unprivileged client",
  );
  await unprivileged.connect();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("createLoginRole", { timeout: TIMEOUT_MS }, () => {
  it("stores a verifier the server can authenticate the password against", async () => {
    const password = ephemeralPassword();
    await createLoginRole(testDb.db, "probe_login_ok", password);

    // The whole point: the role logs in with the **plaintext**, which proves the
    // client-side PBKDF2, the two HMACs and the digest all match what the server expects.
    const client = testDb.register(
      new pg.Client({ connectionString: uriFor("probe_login_ok", password) }),
      "verifier client",
    );
    await client.connect();
    const who = await client.query<{ who: string }>("select current_user as who");
    expect(who.rows[0]?.who).toBe("probe_login_ok");
    await client.end();
  });

  it("stores a SCRAM secret rather than a password, so no statement carried the plaintext", async () => {
    const password = ephemeralPassword();
    await createLoginRole(testDb.db, "probe_scram_shape", password);
    const stored = await testDb.db.execute<{ secret: string | null }>(
      sql`select rolpassword as secret from pg_authid
         where rolname = 'probe_scram_shape'`,
    );
    const secret = stored.rows[0]?.secret ?? "";
    expect(secret).toMatch(/^SCRAM-SHA-256\$4096:/);
    // And the password is nowhere in it, which is what makes the statement safe to log.
    expect(secret).not.toContain(password);
  });

  it("leaves an existing role untouched, including its password", async () => {
    const first = ephemeralPassword();
    await createLoginRole(testDb.db, "probe_idempotent", first);
    const before = await testDb.db.execute<{ secret: string | null }>(
      sql`select rolpassword as secret from pg_authid
         where rolname = 'probe_idempotent'`,
    );
    await createLoginRole(testDb.db, "probe_idempotent", ephemeralPassword());
    const after = await testDb.db.execute<{ secret: string | null }>(
      sql`select rolpassword as secret from pg_authid
         where rolname = 'probe_idempotent'`,
    );
    expect(after.rows[0]?.secret).toBe(before.rows[0]?.secret);
  });

  it("refuses without CREATEROLE, and the refusal carries no credential (SEC-8)", async () => {
    // The shape the review reproduced. `probe_no_createrole` is the documented migration
    // credential's attribute set, so this is the path an operator actually takes.
    const password = "SUPERSECRETPW2";
    // The unprivileged connection as an `Executor`. `drizzle` accepts a `pg.Client`; the
    // cast is to the package's own `Executor` alias, which is structurally this handle.
    const exec = drizzle(unprivileged) as unknown as Parameters<typeof createLoginRole>[0];

    let message: string;
    try {
      await createLoginRole(exec, "probe_refused", password);
      throw new Error("expected the creation to be refused");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
      // The cause is dropped on purpose: the command's `describeError` appends a cause's
      // message to the line it prints, so a wrapper kept there would put the statement
      // back on the terminal.
      expect(error instanceof Error ? error.cause : undefined).toBeUndefined();
    }

    expect(message).toContain("probe_refused");
    expect(message).toMatch(/permission denied to create role/i);
    // The three things that must not be in anything an operator reads.
    expect(message).not.toContain(password);
    expect(message).not.toContain("CREATE ROLE");
    expect(message).not.toContain("Failed query");
  });

  it("refuses a password it cannot represent, before any statement is sent", async () => {
    // SASLprep is the identity on printable ASCII and is not implemented here, so a
    // password needing it is refused rather than stored as a verifier nobody can
    // authenticate against.
    await expect(createLoginRole(testDb.db, "probe_non_ascii", "passéword")).rejects.toThrow(
      /printable ASCII/,
    );
    const exists = await testDb.db.execute<{ found: boolean }>(
      sql`select exists (select 1 from pg_roles where rolname = 'probe_non_ascii') as found`,
    );
    expect(exists.rows[0]?.found).toBe(false);
  });
});
