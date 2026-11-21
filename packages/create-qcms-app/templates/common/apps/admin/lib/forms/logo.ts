/**
 * The logo upload's limits, restated for the file picker: the admin loads neither the database
 * package nor kernel code (R2), and `logo.test.ts` pins each value to the API's own.
 */

export const LOGO_ACCEPT = "image/png,image/jpeg";

export const LOGO_MAX_BYTES = 524_288;

export const LOGO_MAX_LABEL = "512 KB";

export type LogoSizeRefusal = "empty" | "tooLarge";

export function logoSizeRefusal(bytes: number): LogoSizeRefusal | undefined {
  if (bytes === 0) return "empty";
  if (bytes > LOGO_MAX_BYTES) return "tooLarge";
  return undefined;
}
