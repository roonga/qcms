import { acceptTotpStep, authTwoFactor, type Executor } from "@roonga/qcms-db";
// eslint-disable-next-line no-restricted-imports -- the vendor's own cipher module, not Node's; the built-in fence matches its `crypto` segment
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

/** The vendor's key set that decrypts an enrolled secret. */
export type SecretConfig = Parameters<typeof symmetricDecrypt>[0]["key"];

async function hotp(key: CryptoKey, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter), false);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const word =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (word % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/**
 * RFC 6238 over the secret the vendor enrolled, with the vendor's period, digits and window:
 * the newest time step `code` matches, or `undefined`.
 */
async function matchedStep(secret: string, code: string, now: Date): Promise<number | undefined> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = Math.floor(now.getTime() / (TOTP_PERIOD_S * 1000));
  let matched: number | undefined;
  for (let step = -TOTP_WINDOW; step <= TOTP_WINDOW; step += 1) {
    const expected = await hotp(key, counter + step);
    let difference = expected.length ^ code.length;
    for (let i = 0; i < expected.length; i += 1) {
      difference |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    }
    if (difference === 0) matched = counter + step;
  }
  return matched;
}

/**
 * The time step `code` matches on the account's factor, verified or still being enrolled as
 * `verifiedOnly` says, or `undefined` when it matches none.
 */
export async function factorStep(
  exec: Executor,
  secretConfig: SecretConfig,
  input: { readonly userId: string; readonly code: string; readonly verifiedOnly: boolean },
): Promise<number | undefined> {
  const [factor] = await exec
    .select({ secret: authTwoFactor.secret })
    .from(authTwoFactor)
    .where(
      and(
        eq(authTwoFactor.userId, input.userId),
        input.verifiedOnly ? eq(authTwoFactor.verified, true) : undefined,
      ),
    )
    .limit(1);
  if (factor === undefined) return undefined;
  const secret = await symmetricDecrypt({ key: secretConfig, data: factor.secret });
  // An imported secret is stored base32-prefixed; QCMS only ever enrols generated ones.
  if (secret.startsWith("base32:")) return undefined;
  // Wall time, not the injected clock: the code on the person's device is.
  return matchedStep(secret, input.code, new Date());
}

/**
 * Spend `code` on the account's factor: `true` only when it matches and no code at or after its
 * time step was accepted before, which one conditional write decides.
 */
export async function spendTotpCode(
  exec: Executor,
  secretConfig: SecretConfig,
  input: { readonly userId: string; readonly code: string; readonly verifiedOnly: boolean },
): Promise<boolean> {
  const step = await factorStep(exec, secretConfig, input);
  if (step === undefined) return false;
  return acceptTotpStep(exec, { userId: input.userId, step, verifiedOnly: input.verifiedOnly });
}
