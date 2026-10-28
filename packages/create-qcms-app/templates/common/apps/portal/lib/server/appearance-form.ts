import { z } from "zod";

// Relative, not the `@/` alias: Vitest resolves no Next path aliases.
import {
  APPEARANCE_MODES,
  APPEARANCE_ROUTE,
  DENSITY_LEVELS,
  type AppearanceChoice,
} from "../appearance";

/**
 * What the no-JS appearance route's posted values may be, and where its redirect may
 * point: two pure functions over hostile strings, which is why they are here rather
 * than in the route (R2).
 *
 * Neither reads the environment or a cookie. The offered font list is passed in, because
 * a validator that reached for config would be untestable without stubbing it.
 */

export const DEFAULT_RETURN = "/";

/**
 * A synthetic origin rather than the configured base, and that is the point: the only
 * property checked is whether a relative reference stays inside its own origin, which it
 * either does or does not whatever that origin is. A constant means the check cannot be
 * defeated by an unset or mis-set `QCMS_PORTAL_BASE_URL`.
 *
 * `.invalid` is reserved (RFC 2606), so this can never name a real host.
 */
const PROBE_ORIGIN = "https://portal.invalid";

/**
 * Both are separator characters in disguise, and a percent-encoded slash is deliberately
 * not decoded during path normalisation, so it would be handed on as a path whose
 * meaning depends on what decodes it next. No path this portal serves contains one.
 */
const ENCODED_SEPARATOR = /%2f|%5c/iu;

/**
 * A validated same-origin path, or `undefined`. Every rejection lands on the same
 * answer, so probing teaches nothing.
 *
 * Checking the candidate for a leading `//` would not be enough, because dot-segment
 * normalisation resolves `/..//evil.example` to the pathname `//evil.example`: a single
 * leading slash goes in and a protocol-relative reference comes out, and the origin
 * check passes because the resolution happened inside the probe origin. So the
 * leading-`//` test is applied to the parser's output, and a backslash or an encoded
 * separator anywhere in the candidate is refused outright. The route emits the result as
 * an absolute URL on the portal's own origin, which is the second, independent control.
 *
 * The appearance route is refused as a target although it is same-origin, because it
 * exports `POST` only and redirecting there hands the respondent a 405.
 *
 * The hash is dropped: it never reaches a server, so carrying it would only widen what
 * this has to reason about.
 */
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

/**
 * Where the appearance form's 303 points: the page the respondent submitted it from.
 *
 * Precedence is the hidden field, then the `Referer`, then the site root, and the
 * order is not arbitrary.
 *
 * **The `Referer` leg is live on this deployment since task 073.** The portal used to
 * send `Referrer-Policy: no-referrer`, under which a form navigation carries no
 * `Referer` at all, so the hidden field was the only thing that ever supplied the
 * return target and this leg existed for a deployment that relaxed the policy at its
 * ingress. The portal now sends `same-origin` (Code Owner, 2026-10-01, SEC-9 as
 * amended, because Next's Server Action check refuses a null origin), so a same-origin
 * form navigation does carry the submitting page's URL and this leg can now answer.
 *
 * **Nothing about what is allowed changed, which is why the ordering survived the
 * policy change untouched.** The hidden field still wins, because it is what the form
 * declares rather than what the browser happened to send; both are
 * respondent-controllable strings; and both go through the same `internalPath` check,
 * so which one supplied the value changes nothing about what is admitted. A `Referer`
 * naming a foreign origin, a different scheme, a sibling subdomain or the appearance
 * route itself still falls back to the site root.
 *
 * Total: there is always an answer, and the worst case is the site root.
 */
export function safeReturnPath(
  candidate: string | undefined,
  referer: string | undefined,
  baseUrl: string | undefined,
): string {
  return internalPath(candidate) ?? refererPath(referer, baseUrl) ?? DEFAULT_RETURN;
}

/**
 * The posted appearance values, or `{}` when they are not exactly what the form emits.
 *
 * Precisely: an ABSENT axis is simply not written (each member is `.optional()`, and a
 * submission that omits one is asking for nothing on that axis, not for a reset). A
 * PRESENT axis carrying anything outside its enumeration fails the whole object, so no
 * axis is written at all.
 *
 * Rejecting whole rather than dropping the offending axis, because the only thing that
 * produces this form is the portal's own markup and it always posts all three: a radio
 * group always has a checked member and a `<select>` always has a value. So a submission
 * with a bad value in it was hand-built, and applying the half of it that happened to
 * parse would be honouring a request nobody made. The respondent still gets their page
 * back (the route redirects either way); they just get it unchanged.
 *
 * Mode and density are closed enumerations from `lib/appearance.ts`. **Font is not**:
 * which faces exist is the `@roonga/qcms-ui` registry and which of them a deployment
 * OFFERS is `QCMS_PORTAL_FONTS`, so the enumeration is built per request from the
 * offered keys. Validating against the registry instead would let a respondent pin a
 * face their deployment curated away, which is the same reasoning `resolveAppearance`
 * already applies when it reads the cookie back.
 */
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

/**
 * The schema for one submission. Built per call because the font enumeration depends
 * on the deployment's offered list.
 *
 * `z.enum` needs at least one member. `portalFontChoices()` always contains System, so
 * the empty case is unreachable in the app; `z.never()` is the honest schema for it
 * anyway, and it fails closed (no font is acceptable) rather than open.
 */
function choiceSchema(offeredFonts: readonly string[]) {
  const font =
    offeredFonts.length > 0 ? z.enum([...offeredFonts] as [string, ...string[]]) : z.never();
  return z.object({
    mode: z.enum(APPEARANCE_MODES).optional(),
    font: font.optional(),
    density: z.enum(DENSITY_LEVELS).optional(),
  });
}
