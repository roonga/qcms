import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Pinned rather than inferred: Next would otherwise find the shared main checkout's
// lockfile and resolve modules from there instead of from this worktree.
const WORKTREE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const PRODUCTION_DIST_DIR = ".next";
const DEVELOPMENT_DIST_DIR = ".next-dev";

/**
 * Dev and production must not share a dist directory: `turbo.json` declares the
 * portal build's outputs as `.next/**`, so dev output under `.next` is tarred into
 * the build cache and a later cache hit restores that stale snapshot over live dev
 * state, which surfaces only as a Playwright `webServer` timeout.
 */
export default function portalNextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? DEVELOPMENT_DIST_DIR : PRODUCTION_DIST_DIR,
    reactStrictMode: true,
    turbopack: {
      root: WORKTREE_ROOT,
    },
    output: "standalone",
    outputFileTracingRoot: WORKTREE_ROOT,
    // No `sharp`: its native libvips binary is LGPL-3.0, which the no-copyleft
    // redistribution policy and `check:licenses` forbid.
    images: { unoptimized: true },
    experimental: {
      // Off so that building this app makes no advisory call to the npm registry.
      agentUpgrade: false,
    },
  };
}
