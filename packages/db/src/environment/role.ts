/**
 * Creating a login role, which is the one statement in this package that carries a
 * credential (SEC-8, SEC-10).
 *
 * # The password never reaches a statement, so nothing can log it
 *
 * `CREATE ROLE` takes an identifier and a literal and **neither can be a bind parameter**,
 * so a credential has to end up inside statement text somewhere. That text is logged in at
 * least three places nobody chose: drizzle wraps a failed statement in a
 * `DrizzleQueryError` whose message is `Failed query: <sql>\nparams: <params>`, the
 * environment command prints an error's message to an operator's terminal, and the
 * **server** records the statement in its own log, because `log_min_error_statement`
 * defaults to `error`. PR #1093's review reproduced all three: a `--password` run printed
 * `PASSWORD 'SUPERSECRETPW2'` on stderr and left the same line in the Postgres log.
 *
 * So the plaintext is not what goes into the statement. This module computes the
 * **SCRAM-SHA-256 verifier** for the password and sends that, which PostgreSQL documents as
 * supported and stores as-is: "If the presented password string is already in
 * MD5-encrypted or SCRAM-encrypted format, then it is stored as-is regardless of
 * `password_encryption`" (PostgreSQL 16, `CREATE ROLE`, the `PASSWORD` clause; and the
 * `password_encryption` entry in Server Configuration). The verifier is a salted,
 * 4096-iteration PBKDF2 digest, so a statement carrying it is not a statement carrying the
 * password: the operator's terminal, drizzle's error and the server log all get the
 * verifier, and the credential itself never leaves this function.
 *
 * That is the same thing `libpq`'s `PQencryptPasswordConn` does for `psql`'s `\\password`,
 * and for the same stated reason.
 *
 * # And a refusal still cannot carry the statement
 *
 * Belt as well as braces, because the verifier is not a secret but the role name and the
 * driver's complaint are all an operator needs: every statement here runs inside
 * {@link refuseWithoutStatement}, which rethrows an error carrying the role, the act and
 * the **driver's** message, and never drizzle's wrapper, its `params`, or any `cause` the
 * command's own `describeError` would unwrap into the terminal.
 *
 * # Why the role may need a credential this connection cannot create
 *
 * `qcms_migrate` is created `LOGIN` only and holds no `CREATEROLE` (`docker-compose.yml`,
 * and `03-db-least-privilege.e2e.ts` asserts it deliberately), so `--password` run under
 * the migration credential is refused by the server. That is correct and documented rather
 * than worked around: roles are cluster-level and the recipe in `docs/operations.md` has a
 * superuser create them. What this module guarantees is that the refusal an operator reads
 * names the role and the reason and nothing else.
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";

/** PostgreSQL's own default for a SCRAM secret, and what `psql` computes with. */
const SCRAM_ITERATIONS = 4096;

/** The salt length `libpq` uses for a client-computed verifier. */
const SCRAM_SALT_BYTES = 16;

/**
 * The bytes a password contributes to its verifier.
 *
 * **Printable ASCII only, and a refusal otherwise.** PostgreSQL applies SASLprep to the
 * password on both sides of an authentication, and the verifier has to be computed over the
 * same normalised form or the role simply cannot log in. SASLprep is the identity on
 * printable ASCII, which is what a credential out of a secret store is, so this covers
 * every case the recipe produces and refuses the one case it would get subtly wrong rather
 * than storing a verifier nobody can authenticate against.
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
  // Copied into a buffer-backed view: `TextEncoder` is typed over `ArrayBufferLike`, and
  // WebCrypto's `BufferSource` is not satisfied by a `SharedArrayBuffer`-backed one.
  return copy(new TextEncoder().encode(password));
}

/** A `Uint8Array` over a plain `ArrayBuffer`, which is what WebCrypto's types ask for. */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

/** `Uint8Array` to base64, without Node's `Buffer` so this module needs no `node:` import. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The PostgreSQL SCRAM-SHA-256 stored secret for one password:
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`.
 *
 * The derivation is RFC 5802's: `SaltedPassword = PBKDF2(password, salt, i)`,
 * `ClientKey = HMAC(SaltedPassword, "Client Key")`, `StoredKey = SHA256(ClientKey)`,
 * `ServerKey = HMAC(SaltedPassword, "Server Key")`. WebCrypto rather than `node:crypto`,
 * so the one module in this package that touches a credential depends on nothing
 * platform-specific (R4's spirit, and the same choice the API makes for its own hashing).
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
 * Run one statement, and on failure rethrow an error that names the act, the role and the
 * **driver's** complaint, with no statement text, no bind parameters and no `cause`.
 *
 * No `cause`, deliberately: `environment-cli.ts`'s `describeError` appends a cause's
 * message to the line it prints, so attaching drizzle's wrapper would put the statement
 * back on the terminal through the very helper that is supposed to summarise it.
 */
async function refuseWithoutStatement<T>(
  act: string,
  role: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    // drizzle wraps the driver error as its `cause`; that inner message is the useful one
    // ("permission denied to create role") and is the only part of the failure that is
    // safe to repeat.
    const inner = error instanceof Error ? error.cause : undefined;
    const because = inner instanceof Error ? inner.message : "the database refused it";
    throw new Error(`could not ${act} the role ${role}: ${because.replaceAll(/\s+/g, " ").trim()}`);
  }
}

/**
 * `CREATE ROLE <role> LOGIN PASSWORD <verifier>`, unless the role already exists.
 *
 * Idempotent, because both callers are commands an operator may run twice: the environment
 * command after a failure, and the reporting reconciliation after every workspace they
 * create. An existing role is left exactly as it is - **its password is not reset** - since
 * silently rotating a credential other systems are connecting with would be a side effect
 * nobody asked for.
 *
 * The role name is quoted by **Postgres**, through `format('%I', ...)` over a bind
 * parameter, so nothing here has to be correct about identifier escaping. The verifier goes
 * through `%L` the same way. Both are cast to `text` explicitly, because `format` is
 * variadic over `any` and Postgres cannot infer a placeholder's type from it.
 */
export async function createLoginRole(
  exec: Executor,
  role: string,
  password: string,
): Promise<void> {
  const existing = await refuseWithoutStatement("look up", role, () =>
    exec.execute<{ found: boolean }>(
      sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
    ),
  );
  if (existing.rows[0]?.found === true) return;

  // Computed before anything is sent, so a password this function cannot represent is
  // refused without a round trip.
  const verifier = await scramVerifier(password);

  const built = await refuseWithoutStatement("build the statement for", role, () =>
    exec.execute<{ statement: string }>(
      sql`select format('CREATE ROLE %I LOGIN PASSWORD %L', ${role}::text, ${verifier}::text) as statement`,
    ),
  );
  const statement = built.rows[0]?.statement;
  if (statement === undefined) {
    throw new Error(`could not build the CREATE ROLE statement for ${role}`);
  }
  await refuseWithoutStatement("create", role, () =>
    // check-security-hygiene: allow server-built DDL whose identifier and SCRAM verifier were quoted by Postgres
    exec.execute(sql.raw(statement)),
  );
}
