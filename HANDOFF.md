HANDOFF: INTERRUPTED

Task 117 is implemented and the PR is open (#1400). Everything below the browser is green.
One browser journey, the one this branch adds, fails on its last step and needs a fix before
review. The lane ran out of working room diagnosing it; nothing here waits on a decision.

## What is green

- `pnpm verify`: EXIT=0.
- `pnpm exec turbo run test --force`: 0 cached, 21 tasks; the first run hit two Postgres
  containers that would not start under another seat's load, and the forced re-run of
  `qcms-api` alone was 148 files, 3509 tests, 0 cached, EXIT=0.
- `QCMS_PORT_SEAT=1 pnpm verify:browser` (detached, 3999s): 731 passed, 4 failed. Two are
  the known #1387 failures (`reflow.pw.ts:116`, `two-person-rule.pw.ts:153`). The run
  reports cross-lane contention: seat 3 held its harness ports for part of it.

## The one real failure

`apps/admin/e2e/theme-derive.pw.ts:93`, at line 128. The derive itself passed: the values
row, the lower-cased `#0f766e`, the face, the logo line, the live preview token and the
`Not saved` row all asserted before it. What did not arrive is
`{name} is a workspace theme now.` after Save as workspace theme, so
`createWorkspaceThemeAction` refused and the drawer showed its refusal instead.

`forced-password-change.pw.ts:97` also failed; it is not a known #1387 failure and may be
the contention the report names. Re-run it on a quiet host before treating it as a
regression.

## What to do next

1. Re-run the one spec on a quiet host and read the refusal:
   `QCMS_HARNESS_BUILD=1 QCMS_PORT_SEAT=1 pnpm exec playwright test apps/admin/e2e/theme-derive.pw.ts --project admin-chromium -g "keeps it as a theme"`.
   The drawer renders the code's own sentence in `qcms-appearance-theme-save-error`, so the
   screenshot or the trace names it.
2. The likely causes, in order: the create route refusing the derived palettes on the WCAG
   contrast check (`APPEARANCE_CONTRAST`, which the drawer would word pair by pair), or the
   logo key the derive stored not being readable by the create route (`LOGO_UNKNOWN`).
   Both are route-side refusals the admin seam passes through; neither changes the flow.
3. The unit side already covers the save path (`appearance-drawer.test.tsx`, 23 tests), so
   this is about what the API accepts, not about the drawer.
