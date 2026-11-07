import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** Pin this worktree root: lockfile discovery can otherwise resolve modules from the shared main checkout. */
const WORKTREE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const PRODUCTION_DIST_DIR = ".next";

const DEVELOPMENT_DIST_DIR = ".next-dev";

/** Separate production and dev output roots so Turbo build-cache restoration cannot overwrite a live Turbopack cache. */
export default function adminNextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? DEVELOPMENT_DIST_DIR : PRODUCTION_DIST_DIR,
    reactStrictMode: true,
    turbopack: {
      root: WORKTREE_ROOT,
    },
    /** Trace from the pinned workspace root so standalone output includes hoisted runtime dependencies outside apps/admin. */
    output: "standalone",
    outputFileTracingRoot: WORKTREE_ROOT,
    /** Never add CORS headers to this same-origin BFF. Disable image optimization so the standalone image needs no optional sharp/libvips dependency. */
    images: { unoptimized: true },
    experimental: {
      /** Prevent advisory network requests when the build detects an agent. */
      agentUpgrade: false,
    },
    /** Keep legacy bookmarks as redirects without registering another screen. */
    redirects: () =>
      Promise.resolve([
        {
          source: "/forms/:formId/releases",
          destination: "/forms/:formId/versions",
          permanent: false,
        },
        // Config entries, not pages: a page is a route and costs six registrations while
        // producing no document. Next carries the query; 308 keeps the export's method.
        {
          source: "/forms/:formId/responses",
          destination: "/operations/forms/:formId/responses",
          permanent: true,
        },
        {
          source: "/forms/:formId/responses/:sessionId",
          destination: "/operations/forms/:formId/responses/:sessionId",
          permanent: true,
        },
        {
          source: "/forms/:formId/links",
          destination: "/operations/forms/:formId/links",
          permanent: true,
        },
        {
          source: "/forms/:formId/webhooks",
          destination: "/operations/forms/:formId/webhooks",
          permanent: true,
        },
        {
          source: "/forms/:formId/export",
          destination: "/operations/forms/:formId/export",
          permanent: true,
        },
        {
          source: "/operations/forms/:formId/intake",
          destination: "/operations/forms/:formId/availability",
          permanent: true,
        },
        {
          /* `all` is the area's own list, not a workspace id, so it is excluded here: a
             redirect runs before routing and would swallow that screen. */
          source: "/workspaces/:workspaceId((?!all$)[^/]+)",
          destination: "/workspaces/:workspaceId/members",
          permanent: false,
        },
      ]),
  };
}
