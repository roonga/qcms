import { getLogo } from "@/lib/server/api";

/**
 * The content-addressed key the appearance carries: the lowercase hex SHA-256 of the
 * stored bytes. Checked here so a malformed key costs no API call.
 */
const LOGO_KEY = /^[0-9a-f]{64}$/u;

/**
 * Content-addressed and immutable, so a year is safe: nothing can ever be stored under
 * this key but these bytes.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** The three the API ever serves. A stored logo is one of them, sniffed at upload. */
const SERVED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** One answer for every refusal, so the route says nothing about which keys exist. */
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * The respondent-facing logo, served from the portal's own origin so SEC-9's `img-src
 * 'self'` holds without widening it. No session: a logo is served to whoever the form is
 * served to, and it reads no form, version or response. The content type is the one the
 * API stored from its magic-number sniff, and it is passed through only if it is still
 * one of the three raster types, with `nosniff` so no browser may decide otherwise. The
 * Content-Security-Policy is the proxy's, which sets it on every response here.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await ctx.params;
  if (!LOGO_KEY.test(key)) return notFound();

  const logo = await getLogo(key);
  if (logo === undefined) return notFound();
  const contentType = logo.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!SERVED_TYPES.has(contentType)) return notFound();

  return new Response(logo.bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "cache-control": CACHE_CONTROL,
    },
  });
}
