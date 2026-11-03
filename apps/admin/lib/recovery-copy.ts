/** Clipboard success means the write completed, not merely that a promise was started. Always report success or a manual-copy remedy. */

/** Use one code per line for password-manager bulk paste, matching the displayed list. */
export function recoveryCodesText(codes: readonly string[]): string {
  return codes.join("\n");
}

export type CopyOutcome = "copied" | "failed";

/** Always resolve an outcome; a rejected clipboard promise must not leave the operator without status. */
export async function copyRecoveryCodes(
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  codes: readonly string[],
): Promise<CopyOutcome> {
  if (clipboard === undefined) return "failed";
  try {
    await clipboard.writeText(recoveryCodesText(codes));
    return "copied";
  } catch {
    return "failed";
  }
}
