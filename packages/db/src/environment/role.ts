/**
 * The plaintext password must never reach statement text, which drizzle's error, stderr and the server log
 * all record (SEC-8): this module sends the SCRAM-SHA-256 verifier and runs every statement inside
 * {@link refuseWithoutStatement}.
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";

/** PostgreSQL's own default for a SCRAM secret, and what `psql` computes with. */
const SCRAM_ITERATIONS = 4096;

/** The salt length `libpq` uses for a client-computed verifier. */
const SCRAM_SALT_BYTES = 16;

/**
 * Printable ASCII only: PostgreSQL applies SASLprep on both sides of an authentication,
 * and SASLprep is the identity only on printable ASCII, so anything else would store a
 * verifier nobody can authenticate against.
 */
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (!/^[\x20-\x7e]+$/.test(password)) {
    throw new Error(
      "the password must be printable ASCII: this command computes the SCRAM verifier " +
        "itself so the credential never reaches a logged statement, and doing that for a " +
        "password needing SASLprep normalisation would store a verifier the server cannot " +
        "authenticate against. Use an ASCII credential, or create the role yourself with " +
        "`CREATE ROLE ... LOGIN PASSWORD ...` as a superuser.",
    );
  }
  // `TextEncoder` is typed over `ArrayBufferLike`, and WebCrypto's `BufferSource` is not
  // satisfied by a `SharedArrayBuffer`-backed one.
  return copy(new TextEncoder().encode(password));
}

/** WebCrypto's types ask for a plain `ArrayBuffer` backing. */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

/** Hand-rolled so this module needs no `node:` import (R4). */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * PostgreSQL's stored-secret format, `SCRAM-SHA-256$<iterations>:<salt>$<key>:<key>`, over
 * RFC 5802's derivation. WebCrypto rather than `node:crypto` (R4).
 */
async function scramVerifier(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SCRAM_SALT_BYTES));
  const material = await crypto.subtle.importKey("raw", passwordBytes(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salted = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: SCRAM_ITERATIONS, hash: "SHA-256" },
      material,
      256,
    ),
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    salted,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = async (message: string): Promise<Uint8Array<ArrayBuffer>> =>
    new Uint8Array(
      await crypto.subtle.sign("HMAC", hmacKey, copy(new TextEncoder().encode(message))),
    );

  const clientKey = await mac("Client Key");
  const storedKey = new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey));
  const serverKey = await mac("Server Key");

  return (
    `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${base64(salt)}$` +
    `${base64(storedKey)}:${base64(serverKey)}`
  );
}

/**
 * Rethrows naming the act, its subject and the driver's complaint, with no statement
 * text, no bind parameters and no `cause`: `describeError` appends a cause's message to
 * the line it prints, so attaching drizzle's wrapper would put the statement back on an
 * operator's terminal (SEC-8).
 */
export async function refuseWithoutStatement<T>(
  act: string,
  subject: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    // drizzle's `cause` holds the driver's own message, the only part safe to repeat.
    const inner = error instanceof Error ? error.cause : undefined;
    const because = inner instanceof Error ? inner.message : "the database refused it";
    // eslint-disable-next-line preserve-caught-error -- a `cause` would re-leak the statement
    throw new Error(`could not ${act} ${subject}: ${because.replaceAll(/\s+/g, " ").trim()}`);
  }
}

/**
 * Idempotent; an existing role's password is deliberately not reset, since rotating a credential other
 * systems use would be an unrequested side effect.
 * Name and verifier are quoted by Postgres through `format('%I'/'%L', ...)` over bind parameters, cast to
 * `text` because `format` is variadic over `any`.
 */
export async function createLoginRole(
  exec: Executor,
  role: string,
  password: string,
): Promise<void> {
  const existing = await refuseWithoutStatement("look up", `the role ${role}`, () =>
    exec.execute<{ found: boolean }>(
      sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
    ),
  );
  if (existing.rows[0]?.found === true) return;

  const verifier = await scramVerifier(password);

  const built = await refuseWithoutStatement("build the statement for", `the role ${role}`, () =>
    exec.execute<{ statement: string }>(
      sql`select format('CREATE ROLE %I LOGIN PASSWORD %L', ${role}::text, ${verifier}::text) as statement`,
    ),
  );
  const statement = built.rows[0]?.statement;
  if (statement === undefined) {
    throw new Error(`could not build the CREATE ROLE statement for ${role}`);
  }
  await refuseWithoutStatement("create", `the role ${role}`, () =>
    // check-security-hygiene: allow server-built DDL whose identifier and SCRAM verifier were quoted by Postgres
    exec.execute(sql.raw(statement)),
  );
}
