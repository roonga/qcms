// Relative, not the `@/` alias: Vitest resolves no Next path aliases (as in `proxy.ts`).
import { getLogo } from "../../../lib/server/api";

/**
 * The content-addressed key the appearance carries: the lowercase hex SHA-256 of the
 * stored bytes. Checked here so a malformed key costs no API call.
 */
const LOGO_KEY = /^[0-9a-f]{64}$/u;

/**
 * Revalidated rather than `immutable`: a Site administrator may take a logo down, and a
 * cache that never asks again would go on serving it.
 */
const CACHE_CONTROL = "public, max-age=86400, must-revalidate";

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
 * Served from the portal's own origin so SEC-9's `img-src 'self'` holds unwidened, and
 * without a session: a logo reaches whoever the form reaches. The type is the one the API
 * sniffed at upload, passed through only while it is still raster. The
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
      // The key is the digest of the bytes, so it is already the strong validator.
      etag: `"${key}"`,
    },
  });
}
