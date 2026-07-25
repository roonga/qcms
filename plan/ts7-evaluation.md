# TypeScript 7 (native compiler) evaluation - 2026-07-25

Side-by-side, non-gating comparison of TypeScript 7.0.2 (the native compiler, npm `latest`) against the repo's pinned 6.0.3, run by the PO seat at the Code Owner's request. No repo configuration changed; TS 7 ran via `pnpm --package=typescript@7.0.2 dlx tsc`.

## Method

For each workspace project with a `typecheck` script (`tsc -p tsconfig.json --noEmit`): one warm-up run, one timed run, per compiler, against the same built tree (commit `69787cd`). Diagnostics and exit codes captured.

## Results

| Project | tsc 6.0.3 | tsc 7.0.2 (native) | Speedup |
| --- | --- | --- | --- |
| packages/core | 1797ms | 709ms | 2.5x |
| packages/a2ui-compiler | 1804ms | 551ms | 3.3x |
| packages/db | 13114ms | 6041ms | 2.2x |
| packages/ui | 7019ms | 1811ms | 3.9x |
| apps/api | 9243ms | 2492ms | 3.7x |
| apps/portal | 1657ms | 623ms | 2.7x |
| apps/admin (placeholder) | 417ms | 385ms | n/a |
| **Total** | **35.1s** | **12.6s** | **2.8x** |

- **Diagnostics parity: exact.** All seven projects exit 0 under both compilers with zero diagnostics. The native compiler accepted every tsconfig in the repo unchanged, including the packages/ui vendored-a2ra shape (`module: Preserve`, `rewriteRelativeImportExtensions`).
- The TS 7 timings **include** `pnpm dlx` launcher overhead (roughly 300-500ms per run), so the true per-project speedups are somewhat higher than shown.

## Ecosystem constraints (as of 2026-07-25)

- `typescript-eslint` (incl. canary 8.65.1-alpha.7) peers `typescript >=4.8.4 <6.1.0`. The repo's binding lint gate is type-aware (error-severity sonarjs + typescript-eslint rules), so a full switch to 7 breaks the gate.
- This is structural, not lag: **TS 7.0 ships no stable programmatic API** (planned for 7.1), so no tooling that imports TypeScript's API can support 7 yet.
- Microsoft's supported adoption path (TS 7.0 announcement, "Running side by side with TypeScript 6.0"): keep the `typescript` package name on 6 via alias so peer-dep tooling resolves it, add 7 under a second alias for CLI type-checking:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

## Options

1. **Track (recommended).** Stay on 6.x for the gate. Re-evaluate at TS 7.1 (stable API) + a typescript-eslint line that admits it; adoption then becomes a one-PR dep bump with no dual-compiler window. The absolute win today is ~22s on a full uncached typecheck, which turbo caching and CI wall-clock (dominated by the ~5min e2e jobs) mostly hide.
2. **Adopt the side-by-side now.** `typecheck` scripts move to the native `tsc` (2.8x), eslint keeps 6 via the alias. Cost: two type-checkers in the gate whose agreement is observed (verified exact today) rather than guaranteed; a package.json aliasing arrangement to document in CONTRIBUTING; and the pairing must be re-verified on every TS bump.
3. **Full switch.** Blocked by the lint gate until 7.1-era typescript-eslint exists.

The determinism concern that recommends option 1 over 2: with two compilers, "typecheck green" (TS 7) and "type-aware lint's view" (TS 6) can in principle diverge; both run in CI so drift would surface as gate disagreement rather than silently, but a launch-gated repo gains little from carrying that window for 22 cached-away seconds.

Decision: Code Owner's. This document records the evidence either way.
