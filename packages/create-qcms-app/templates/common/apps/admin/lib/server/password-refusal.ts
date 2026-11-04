// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- an error code on the wire, not a credential
export const PASSWORD_COMPROMISED_CODE = "PASSWORD_COMPROMISED";

export type PasswordRefusal = "compromised" | "generic";

/** Only the exact breach-corpus code earns specific feedback. Malformed or unfamiliar refusals stay generic to prevent enumeration. */
export function passwordRefusalOf(body: unknown): PasswordRefusal {
  if (typeof body !== "object" || body === null) return "generic";
  const { code } = body as { code?: unknown };
  return code === PASSWORD_COMPROMISED_CODE ? "compromised" : "generic";
}

/** Non-JSON refusals still render the generic message. Consume only refused responses so successful cookies remain available. */
export async function passwordRefusalFrom(response: Response): Promise<PasswordRefusal> {
  const body: unknown = await response.json().catch(() => undefined);
  return passwordRefusalOf(body);
}
