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
      ]),
  };
}
