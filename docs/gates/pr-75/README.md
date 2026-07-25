# Gate evidence - PR #75 (issue #21)

What to approve: the sentence pattern **"{label} needs an answer."** in the error
summary, one entry per missing required question, replacing the identical
"This question needs an answer." on every entry. Nothing else in the
blocked-submit state changed.

Captured from this branch with the Playwright e2e harness (kitchen-sink fixture,
Continue pressed with both required questions empty). The red "1 Issue" badge in
the lower-left corner is the Next.js dev-tools overlay (dev server only), not
product UI.
