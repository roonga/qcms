import { and, eq, gt, isNull } from "drizzle-orm";

import { signInLinks } from "../schema/control/sign-in-links.js";
import type { SignInLinkDelivery, SignInLinkPurpose } from "../schema/control/sign-in-links.js";
import type { Executor } from "./executor.js";

/** One stored sign-in link, as the claim path reads it back. Never carries the token. */
export interface SignInLinkRow {
  readonly id: string;
  readonly userId: string;
  readonly purpose: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly invalidatedAt: Date | null;
  readonly delivery: string;
  readonly issuedBy: string;
  readonly createdAt: Date;
}

const columns = {
  id: signInLinks.id,
  userId: signInLinks.userId,
  purpose: signInLinks.purpose,
  expiresAt: signInLinks.expiresAt,
  usedAt: signInLinks.usedAt,
  invalidatedAt: signInLinks.invalidatedAt,
  delivery: signInLinks.delivery,
  issuedBy: signInLinks.issuedBy,
  createdAt: signInLinks.createdAt,
} as const;

/**
 * Supersede every live link the account holds and store the digest of the new one. Both
 * halves in the caller's transaction, so a resend can never leave two usable links.
 */
export async function issueSignInLink(
  exec: Executor,
  input: {
    readonly userId: string;
    /** Lower-case hex SHA-256 of the token; the token itself never reaches this package. */
    readonly tokenHash: string;
    readonly purpose: SignInLinkPurpose;
    readonly expiresAt: Date;
    readonly issuedBy: string;
    readonly now: Date;
  },
): Promise<SignInLinkRow> {
  await exec
    .update(signInLinks)
    .set({ invalidatedAt: input.now })
    .where(
      and(
        eq(signInLinks.userId, input.userId),
        isNull(signInLinks.usedAt),
        isNull(signInLinks.invalidatedAt),
      ),
    );
  const [row] = await exec
    .insert(signInLinks)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      issuedBy: input.issuedBy,
      createdAt: input.now,
    })
    .returning(columns);
  if (row === undefined) throw new Error("sign_in_links insert returned no row");
  return row;
}

/** Record what the relay answered, so the Accounts screen can report a failed delivery. */
export async function recordSignInLinkDelivery(
  exec: Executor,
  id: string,
  delivery: SignInLinkDelivery,
): Promise<void> {
  await exec.update(signInLinks).set({ delivery }).where(eq(signInLinks.id, id));
}

/**
 * Atomically consume one link. The compare-and-set is the whole single-use guarantee: a
 * used, superseded or expired row matches nothing and comes back `undefined`, so reuse and
 * a 72-hour-old link are refused by the same statement and look identical to the caller.
 */
export async function consumeSignInLink(
  exec: Executor,
  tokenHash: string,
  now: Date,
): Promise<SignInLinkRow | undefined> {
  const [row] = await exec
    .update(signInLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(signInLinks.tokenHash, tokenHash),
        isNull(signInLinks.usedAt),
        isNull(signInLinks.invalidatedAt),
        gt(signInLinks.expiresAt, now),
      ),
    )
    .returning(columns);
  return row;
}

/**
 * Read one link by digest without consuming it, so a claim can refuse a weak or breached
 * password before it burns the only link the person was sent.
 */
export async function findSignInLinkByHash(
  exec: Executor,
  tokenHash: string,
): Promise<SignInLinkRow | undefined> {
  const [row] = await exec
    .select(columns)
    .from(signInLinks)
    .where(eq(signInLinks.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Whether a link would still be accepted: unused, not superseded and inside its 72 hours. */
export function signInLinkIsLive(link: SignInLinkRow, now: Date): boolean {
  return (
    link.usedAt === null && link.invalidatedAt === null && link.expiresAt.getTime() > now.getTime()
  );
}
