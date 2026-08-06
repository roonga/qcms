import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../errors.js";
import type { AdminPrincipal } from "../../openapi.js";
import { makeRecoveryCodesHandler } from "./handler.js";
import type { AdminAuth } from "./instance.js";

/**
 * The recovery-codes handler's failure translation.
 *
 * ## Why this is a unit test and not a request test
 *
 * The branch under test is "which thrown values become a 409". Driving it through a
 * composed app means driving it through the real better-auth adapter, and making that
 * adapter fail means handing it a rejecting database handle - which it then queries again
 * on its own, after the response, producing an unhandled rejection that reds the run
 * without saying anything about the branch. Measured, not assumed: that is exactly what
 * the first version of this test did.
 *
 * So the seam is taken at the handler. `makeRecoveryCodesHandler` already accepts the
 * auth instance as a thunk (for lazy construction), which makes a throwing stub trivial,
 * and the rendering half is covered where it belongs: `app.test.ts` asserts that an
 * unexpected throw becomes a 500 whose body carries no internals.
 */

const PRINCIPAL: AdminPrincipal = { userId: "au_test", role: "admin", scopes: [] };

/** A context with only what the handler touches: the principal and `json`. */
function fakeContext(principal: AdminPrincipal | undefined) {
  const calls: { body: unknown; status: number }[] = [];
  const context = {
    get: (key: string) => (key === "adminPrincipal" ? principal : undefined),
    json: (body: unknown, status: number) => {
      calls.push({ body, status });
      return { body, status };
    },
  };
  return { context, calls };
}

/**
 * An auth stub whose `viewBackupCodes` behaves as told.
 *
 * `throws` is typed `Error` rather than `unknown` deliberately: every value the real code
 * path can reject with is an `Error` (better-auth's `APIError` extends it, and a driver
 * throw is one), so widening it would only be to let a test express something production
 * cannot do.
 */
function stubAuth(behaviour: { throws?: Error; codes?: string[] }): () => AdminAuth {
  return () =>
    ({
      api: {
        viewBackupCodes: () => {
          if (behaviour.throws !== undefined) return Promise.reject(behaviour.throws);
          return Promise.resolve({ status: true, backupCodes: behaviour.codes ?? [] });
        },
      },
    }) as unknown as AdminAuth;
}

/**
 * Drive the handler. `principal` is REQUIRED rather than defaulted, because a default
 * parameter is re-applied when the argument is explicitly `undefined` - so the
 * no-principal case below silently ran with a principal and passed for the wrong reason
 * until this was tightened.
 */
async function run(auth: () => AdminAuth, principal: AdminPrincipal | undefined) {
  const { context, calls } = fakeContext(principal);
  const handler = makeRecoveryCodesHandler(auth);
  // The handler only uses `get` and `json`; the full Hono context is not needed and
  // faking it whole would test the framework rather than this branch.
  const result = await (handler as unknown as (c: unknown) => Promise<unknown>)(context);
  return { result, calls };
}

describe("makeRecoveryCodesHandler", () => {
  it("returns the account's codes on the happy path", async () => {
    const { calls } = await run(stubAuth({ codes: ["a1b2c-3d4e5", "f6g7h-8i9j0"] }), PRINCIPAL);
    expect(calls).toEqual([{ body: { codes: ["a1b2c-3d4e5", "f6g7h-8i9j0"] }, status: 200 }]);
  });

  it("translates better-auth's no-codes refusal to a 409 with a fixed message", async () => {
    // `viewBackupCodes` raises `APIError.from("BAD_REQUEST", ...)` for both
    // BACKUP_CODES_NOT_ENABLED and INVALID_BACKUP_CODE (better-auth 1.6.25,
    // `dist/plugins/two-factor/backup-codes/index.mjs:329` and `:331`).
    const refusal = new APIError("BAD_REQUEST", { message: "Backup codes aren't enabled" });
    await expect(run(stubAuth({ throws: refusal }), PRINCIPAL)).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    // The library's wording is NOT repeated: it would tell the caller about the account's
    // 2FA state (SEC-1: no enumeration).
    await run(stubAuth({ throws: refusal }), PRINCIPAL).catch((error: unknown) => {
      expect((error as ApiError).message).toBe("No recovery codes exist for this account");
      expect((error as ApiError).message).not.toContain("Backup codes");
    });
  });

  it("RETHROWS a database or transport fault, so it renders as a 500 and not a 409", async () => {
    // The regression this guards: a bare `catch` reported a dead connection pool as
    // "No recovery codes exist for this account" - a conflict an operator reads as their
    // own account state while the deployment is down.
    const fault = new Error("connection terminated unexpectedly");
    await expect(run(stubAuth({ throws: fault }), PRINCIPAL)).rejects.toBe(fault);
  });

  it("rethrows a non-BAD_REQUEST APIError too, since only the refusal is a state", async () => {
    const upstream = new APIError("INTERNAL_SERVER_ERROR", { message: "boom" });
    await expect(run(stubAuth({ throws: upstream }), PRINCIPAL)).rejects.toBe(upstream);
  });

  it("refuses a request with no verified principal rather than guessing an account", async () => {
    await expect(run(stubAuth({ codes: ["x"] }), undefined)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });
});
