import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// This app lives in a git worktree that shares the monorepo. Next would otherwise
// infer the shared main checkout as the workspace root (multiple lockfiles) and
// resolve modules from there; pin the root to this worktree.
const WORKTREE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Where `next build` / `next start` keep the production build. */
const PRODUCTION_DIST_DIR = ".next";
/** Where `next dev` keeps its own output (Next nests it one level: `<dir>/dev`). */
const DEVELOPMENT_DIST_DIR = ".next-dev";

/**
 * Admin Next.js config (task 031). The admin is a separate deployable from the
 * portal because the enterprise topology puts it behind a VPN (ARCHITECTURE §6),
 * and it uses the same strict-BFF pattern: route handlers own the session and the
 * server-held credentials and proxy to the API's `/admin` group only (R2).
 *
 * Exported as a phase function so the dev server and the production build write to
 * DIFFERENT top-level directories, adopted from the portal on day one rather than
 * rediscovered (issue #54, fixed for the portal in PR #56). They must not share
 * one: a turbo build task declares `.next/**` as its outputs, so any dev output
 * living under `.next` gets tarred into the build-cache artifact and a later
 * `pnpm build` cache hit RESTORES that stale snapshot (possibly from a sibling
 * worktree) over the live dev directory. A dev server then reads a stale or
 * partially-restored Turbopack cache and dies, and the only symptom is a bare
 * Playwright `webServer` timeout. Separate directories make the build cache
 * structurally unable to touch dev state.
 */
export default function adminNextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? DEVELOPMENT_DIST_DIR : PRODUCTION_DIST_DIR,
    reactStrictMode: true,
    turbopack: {
      root: WORKTREE_ROOT,
    },
    // The admin never sends CORS headers (SEC-9): it is same-origin with its own
    // BFF route handlers, and no cross-origin API exists. No `headers()` CORS
    // entries here by design; the security headers are set in `proxy.ts`.
    //
    // No image optimization: the admin ships no optimized imagery, so Next needs
    // no `sharp`. That optional dep pulls a native libvips binary under LGPL-3.0;
    // dropping it (with pnpm.ignoredOptionalDependencies in the root package.json)
    // keeps the MIT-redistribution no-copyleft policy pure and the check:licenses
    // gate green.
    images: { unoptimized: true },
  };
}
