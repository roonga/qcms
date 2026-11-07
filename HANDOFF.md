HANDOFF: INTERRUPTED

The omnibus UI branch for #1208 and #1162. Eight changes are committed and verified below; the
browser gate and the PR are the remaining work, plus one item that arrived late.

## Done and verified

- `pnpm check:all`: green at `067a2b91` (every one of 24 checks, templates and comments included).
- `pnpm exec turbo run lint typecheck test --force`: green except `qcms-admin#lint`, whose only two
  errors are in the uncommitted audit spec `apps/admin/e2e/zz-ui-audit.pw.ts` (now removed). 2399
  admin unit tests, the API and db integration suites and the UI package all passed, 0 cached.
- Manual audit on seat 2 against a production build: 16 screens at 1280 in light, dark, hc and
  hc-dark and 6 at 390 in light and hc. Log and screenshots:
  `node scripts/agent-scratch.mjs` then `shots/manual-log.txt`.

## Remaining

1. `QCMS_PORT_SEAT=9 QCMS_HARNESS_BUILD=1 pnpm verify:browser:detached`, then
   `pnpm verify:browser:wait --slice 165` until it stops exiting 75. Specs changed in this branch:
   `shell-frame`, `authoring-environment` (new), `forms-promotion`, `forms-builder`, `a11y-axe`,
   `erasure-environment`, `operations-form-rail`, `ops-focus`, `responses-ops`.
2. Re-run the forced gate once with the audit spec gone, to collect the four tasks turbo cancelled
   when admin lint failed on it.
3. Open the PR from `.prbody.md` in the lane scratch directory (title
   `feat(admin): help pattern, environment scope and the page header's actions`), not merged, no
   review requested.
4. Not started: the Code Owner's "No ovals: round controls" ruling of 2026-11-08 beyond the help
   disc itself. `.qcms-avatar`, `.qcms-modetrigger`, `.qcms-help-dot`, `.qcms-opt-insert__plus`, the
   radio dot, the switch thumb and the assistant pulses still need the locked-circle and
   icon-button treatment, with `.qcms-round` and `.qcms-iconbutton` as the shared classes. The root
   cause the ruling names is confirmed here: `button { min-block-size: var(--admin-control-h) }` in
   `apps/admin/app/globals.css` gives every button a 40px block minimum, which is what drew the help
   disc as a tall oval.
