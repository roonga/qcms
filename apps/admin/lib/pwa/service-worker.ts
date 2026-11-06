/** The path the worker is served from. Root scope needs no `Service-Worker-Allowed` header only here. */
export const SERVICE_WORKER_PATH = "/sw.js";

/** The message a waiting worker takes as permission to replace the active one. */
export const SKIP_WAITING = "SKIP_WAITING";

/**
 * The whole worker. It registers no `fetch` listener and opens no cache, so no authenticated page,
 * API response or respondent answer can be stored by it; `app/sw.js/route.test.ts` asserts both of a served body.
 */
export const SERVICE_WORKER_SOURCE = `self.addEventListener("install", () => {
  // Stay waiting until a page asks: an unannounced takeover reloads under the operator.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data === ${JSON.stringify(SKIP_WAITING)}) self.skipWaiting();
});
`;
