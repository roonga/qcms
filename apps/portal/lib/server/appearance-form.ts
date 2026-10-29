import { z } from "zod";

// Relative, not the `@/` alias: Vitest resolves no Next path aliases.
import {
  APPEARANCE_MODES,
  APPEARANCE_ROUTE,
  DENSITY_LEVELS,
  type AppearanceChoice,
} from "../appearance";

export const DEFAULT_RETURN = "/";

const PROBE_ORIGIN = "https://portal.invalid";

/**
 * Both are separator characters in disguise, and a percent-encoded slash is deliberately
 * not decoded during path normalisation, so it would be handed on as a path whose
 * meaning depends on what decodes it next. No path this portal serves contains one.
 */
const ENCODED_SEPARATOR = /%2f|%5c/iu;

function internalPath(candidate: string | undefined): string | undefined {
  if (candidate === undefined || !candidate.startsWith("/")) return undefined;
  if (candidate.includes("\\") || ENCODED_SEPARATOR.test(candidate)) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(candidate, PROBE_ORIGIN);
  } catch {
    return undefined;
  }
  if (resolved.origin !== PROBE_ORIGIN) return undefined;
  // After normalisation, not before: this is the dot-segment escape above.
  if (resolved.pathname.startsWith("//")) return undefined;
  if (resolved.pathname === APPEARANCE_ROUTE) return undefined;
  return `${resolved.pathname}${resolved.search}`;
}

/** The path of a `Referer` that names this portal's own origin, or `undefined`. */
function refererPath(referer: string | undefined, baseUrl: string | undefined): string | undefined {
  if (referer === undefined || baseUrl === undefined) return undefined;
  let expected: string;
  let sent: URL;
  try {
    expected = new URL(baseUrl).origin;
    sent = new URL(referer);
  } catch {
    return undefined;
  }
  if (sent.origin !== expected) return undefined;
  return internalPath(`${sent.pathname}${sent.search}`);
}

export function safeReturnPath(
  candidate: string | undefined,
  referer: string | undefined,
  baseUrl: string | undefined,
): string {
  return internalPath(candidate) ?? refererPath(referer, baseUrl) ?? DEFAULT_RETURN;
}

export function parseAppearanceChoice(
  form: FormData,
  offeredFonts: readonly string[],
): AppearanceChoice {
  const parsed = choiceSchema(offeredFonts).safeParse({
    mode: field(form, "mode"),
    font: field(form, "font"),
    density: field(form, "density"),
  });
  return parsed.success ? parsed.data : {};
}

/** One form field as a string, or `undefined` for an absent field or an uploaded file. */
function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function choiceSchema(offeredFonts: readonly string[]) {
  const font =
    offeredFonts.length > 0 ? z.enum([...offeredFonts] as [string, ...string[]]) : z.never();
  return z.object({
    mode: z.enum(APPEARANCE_MODES).optional(),
    font: font.optional(),
    density: z.enum(DENSITY_LEVELS).optional(),
  });
}
