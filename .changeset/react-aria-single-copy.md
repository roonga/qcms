---
"@roonga/qcms-ui": patch
---

One copy of `react-aria-components` in the portal's closure again, and the split closed
upstream so it stops coming back (issue #151).

`pnpm --filter qcms-portal why react-aria-components` reported two versions: 1.21.1 on the
direct arm and 1.20.0 nested under `@a2ra/core@1.0.0-preview.7`. Neither range was wrong.
The published `@a2ra/core` declares `react-aria-components: ^1.18.0` as a hard dependency,
and `^1.18.0` admits 1.21.1 perfectly well, but pnpm does not re-resolve a specifier the
lockfile already satisfies, so the nested arm stayed at whatever it was resolved to on the
day it entered and the direct arm moved on without it. Every Dependabot bump moved the
direct arm alone and widened the gap.

`pnpm dedupe` closes it: twelve duplicate packages leave the tree, nothing enters it, and
every version that survives was already installed and already inside the declaring range.
The three that matter here are `react-aria-components` (1.20.0 dropped, one copy at
1.21.1), `@internationalized/date` (3.12.3 dropped, one at 3.12.4) and `zod` (4.4.3
dropped, one at 4.5.4), all three duplicated by the same `@a2ra/core` arm and all three
collapsing together because they are one stale resolution rather than three problems. The
rest are ordinary transitive duplicates the same command reached (`axe-core`, `minimatch`,
`pg-protocol`, `picomatch`, `protobufjs`, `tinyexec`, `tldts-core`, `react-aria`,
`react-stately`).

A lockfile refresh alone is not a fix, because this is the second time the split has been
closed. It was closed once already and reopened at the next bump, which is what a dependency
that both sides declare does. So the declaration moved too: upstream
`roonga/a2-react-aria#81` makes `react-aria-components` a **peer** dependency of
`@a2ra/core`, at the same range, which is what makes a second copy unreachable rather than
merely absent. `packages/ui/a2ra.json` moves to that pull request's head as a provisional
pin, and `packages/ui/a2ra-diff.md` records the whole-tree re-vendor: the pass changes
nothing under upstream's `registry/`, so no vendored byte moves, and the transcript proves
that by git tree hash on both sides as well as through the CLI.

**The hydration mismatch #151 was opened for is unchanged, and the issue stays open.** With
one copy resolved, the reload spec was run with its `test.fail` marker removed and React
reported exactly the same single attribute it reported the last time this was measured:
`inputMode`, `numeric` on the server render and `decimal` on the client. The `role` and
`aria-value*` nulls the issue quoted are printed as unchanged context on both sides, not as
the difference. So the marker goes back on, with its comment updated to record that the
copy-count theory has now been disproven twice, against two different splits.

No product code changes and no vendored source changes: this is a resolution change, a pin
move that moves no byte, and a test comment.
