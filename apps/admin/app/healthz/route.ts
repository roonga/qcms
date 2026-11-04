/* Unauthenticated health probes must reveal no version, build id, or environment. */
export function GET(): Response {
  return new Response("ok\n", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
