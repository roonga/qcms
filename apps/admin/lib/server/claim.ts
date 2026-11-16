import { PASSWORD_COMPROMISED_CODE } from "./password-refusal.ts";

/** Where the emailed single-use link lands. It must match the path the API builds. */
export const CLAIM_PATH = "/claim";

/** The API's code for a token that is unknown, used, expired or bound to another account. */
export const CLAIM_LINK_REFUSED_CODE = "CLAIM_LINK_REFUSED";

/** The API's code for a body the claim schema refuses, which in practice is a short password. */
export const CLAIM_INVALID_BODY_CODE = "INVALID_BODY";

export type ClaimRefusal = "link" | "compromised" | "weak" | "generic";

/**
 * The claim answers through the API's error envelope, so the code sits one level deeper
 * than on the better-auth endpoints. Only the codes the screen acts on are read; every
 * other refusal stays generic.
 */
export async function claimRefusalOf(response: Response): Promise<ClaimRefusal> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
  if (code === CLAIM_LINK_REFUSED_CODE) return "link";
  if (code === PASSWORD_COMPROMISED_CODE) return "compromised";
  return code === CLAIM_INVALID_BODY_CODE ? "weak" : "generic";
}
