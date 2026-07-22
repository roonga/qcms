import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// This app lives in a git worktree that shares the monorepo. Next would otherwise
// infer the shared main checkout as the workspace root (multiple lockfiles) and
// resolve modules from there; pin the root to this worktree.
const WORKTREE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Portal Next.js config (task 029). The portal is SSR-first and fetch-only
 * (ADR-26); no client data library. `@qcms/ui` is a workspace package consumed
 * from its build output, so no `transpilePackages` entry is needed - its dist is
 * plain ESM. The strict BFF keeps the internal API server-only; the base URL is
 * read from server-only config in route handlers (added in the wiring phase).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: WORKTREE_ROOT,
  },
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

export default nextConfig;
