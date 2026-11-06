import { SERVICE_WORKER_SOURCE } from "@/lib/pwa/service-worker";

/* A route handler rather than a `public/` file: the runtime images copy `.next` and not `public`, and the
   two headers below are the worker's update contract rather than a static-asset default. */
export function GET(): Response {
  return new Response(SERVICE_WORKER_SOURCE, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
