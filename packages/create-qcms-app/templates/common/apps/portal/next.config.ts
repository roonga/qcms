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
 * Portal Next.js config (task 029). The portal is SSR-first and fetch-only
 * (ADR-26); no client data library. `@roonga/qcms-ui` is a workspace package consumed
 * from its build output, so no `transpilePackages` entry is needed - its dist is
 * plain ESM. The strict BFF keeps the internal API server-only; the base URL is
 * read from server-only config in route handlers (added in the wiring phase).
 *
 * Exported as a phase function so the dev server and the production build write
 * to DIFFERENT top-level directories (issue #54). They must not share one:
 * `turbo.json` declares the portal build's outputs as `.next/**`, so any dev
 * output living under `.next` gets tarred into the build cache artifact and a
 * later `pnpm build` cache hit RESTORES that stale snapshot (possibly from a
 * sibling worktree) over the live dev directory. A dev server then reads a stale
 * or partially-restored Turbopack cache and dies: seen as CSS resolution errors
 * (issue #54) and as a corrupt cache ("SST file open error", docs/RETRO.md), both
 * of which surface only as a bare Playwright `webServer` timeout. Separate
 * directories make the build cache structurally unable to touch dev state, so no
 * ordering of `pnpm build` and `pnpm exec playwright test` needs a manual clean.
 */
export default function portalNextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? DEVELOPMENT_DIST_DIR : PRODUCTION_DIST_DIR,
    reactStrictMode: true,
    turbopack: {
      root: WORKTREE_ROOT,
    },
    // Next's documented deployment output, and what docker/portal.Dockerfile ships
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
    // `apps/portal` - React, Next itself, every `@roonga/qcms-*` dist, all of which pnpm
    // keeps in the workspace root's `node_modules` - would be left out of the copy and
    // the container would die on its first require. It takes the same worktree root
    // `turbopack.root` takes, and for the same reason: the root has to be pinned
    // rather than inferred from a lockfile search that would find the shared main
    // checkout. With it set, the standalone tree mirrors the workspace layout, so the
    // server lands at `apps/portal/server.js` with one `node_modules` beside it.
    //
    // `next dev` ignores this; the standalone tree is produced by `next build` only.
    output: "standalone",
    outputFileTracingRoot: WORKTREE_ROOT,
    // The portal never sends CORS headers (SEC): it is same-origin with its own
    // BFF route handlers. No `headers()` CORS entries here by design.
    //
    // No image optimization: the portal ships no optimized imagery, so Next needs
    // no `sharp`. That optional dep pulls a native libvips binary under LGPL-3.0;
    // dropping it (with pnpm.ignoredOptionalDependencies in the root package.json)
    // keeps the MIT-redistribution no-copyleft policy pure and the check:licenses
    // gate green.
    images: { unoptimized: true },
  };
}
