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
    // Next's documented deployment output, and what docker/admin.Dockerfile ships
    // (issue #291). `next build` traces the modules the server actually loads and
    // writes them, with a minimal `server.js`, under `<distDir>/standalone`; the image
    // copies that tree instead of running `pnpm deploy --prod` and then copying the
    // whole `.next` directory over the top of it. The repository's standing preference
    // is the vendor's documented setup path over a hand-rolled equivalent, and this is
    // that path: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
    // (read 2026-09-10, page versioned 16.3.4).
    //
    // `outputFileTracingRoot` is not optional here, and the reason is the monorepo.
    // Next traces from the PROJECT directory by default, so everything outside
    // `apps/admin` - React, Next itself, every `@roonga/qcms-*` dist, all of which pnpm
    // keeps in the workspace root's `node_modules` - would be left out of the copy and
    // the container would die on its first require. It takes the same worktree root
    // `turbopack.root` takes, and for the same reason: the root has to be pinned
    // rather than inferred from a lockfile search that would find the shared main
    // checkout. With it set, the standalone tree mirrors the workspace layout, so the
    // server lands at `apps/admin/server.js` with one `node_modules` beside it.
    //
    // `next dev` ignores this; the standalone tree is produced by `next build` only.
    output: "standalone",
    outputFileTracingRoot: WORKTREE_ROOT,
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
