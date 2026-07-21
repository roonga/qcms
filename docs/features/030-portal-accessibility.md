# 030 - Portal accessibility pass

**Stage:** 7 (exit gate) · **Apps/packages:** `apps/portal`, `@qcms/ui` · **Depends on:** 029
**References:** `ARCHITECTURE.md` §11 · `PROJECT_GOAL.md` success criteria · WCAG 2.2 AA

## Context

Accessibility is in-scope during build, not a post-launch pass. 028 built structure; this task does the flow-level work component libraries cannot supply, plus the first manual screen-reader pass. Its outputs gate Stage 7.

## Deliverables

- **Focus management on branch changes:** when answering inserts questions, focus stays put and the insertion is announced; when it removes the focused question, focus moves to a stable, sensible target (document the policy: next visible question, else step heading). Implemented via 028's hooks; policy owned here.
- **Live announcements:** `aria-live` regions for step changes ("Step 2 of 4: Driving history"), question insertion/removal counts, validation-error summaries on failed submit (with links moving focus to each offending field), submission success.
- **Keyboard traversal:** full flow completable keyboard-only; skip link; visible focus indicators meeting contrast; no traps; documented tab-order policy on branch insertion.
- **Error UX:** failed submit renders an error summary (WCAG 3.3) before the first field, focus moved to it; per-field errors associated via `aria-describedby` (028's slots).
- **Automated checks in CI:** axe (via Playwright) on every portal page state in the fixture walkthroughs - including *post-branch-change* states, not just initial render; Lighthouse a11y in CI for flow pages with a 100 threshold.
- **Manual screen-reader pass:** NVDA (Windows/Chromium) + VoiceOver (macOS/Safari) through the kitchen-sink form: every question type operable; branch changes perceivable; errors discoverable; completion announced. Logged as `docs/a11y-pass-<date>.md` - issues fixed or ticketed with severity. (This is a human-in-the-loop step: an agent prepares the script/checklist; Ravi or a tester executes and logs.)
- Honeypot verified invisible to both screen readers during the manual pass (026's requirement).
- Reduced-motion and 200% zoom checks on flow pages.

## Exit criteria

1. axe: zero violations across all tested states; Lighthouse a11y = 100 on entry, flow, error, and completion pages (CI-enforced).
2. Keyboard-only Playwright walkthrough of the insurance fixture passes, including a branch insertion and removal.
3. Manual pass log committed; zero open severity-1 (blocker) issues.
4. Focus/announcement policies documented in `docs/a11y.md` (the admin app, 031–035, inherits them).

## Out of scope

Admin-app accessibility (031–035 inherit the policies; admin has its own axe gate), WCAG AAA extras, localization of announcements beyond the shell catalog.
