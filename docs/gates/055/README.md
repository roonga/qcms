# Gate evidence - task 055 (QCMS app theme application)

Approve the **applied** theme: the Cobalt token sheet, Lexend, the sharp 4/8/2 corner
scale, 40px controls, the translucent mode-following topbar, and the operator's mode
control. The design itself was approved on 2026-07-30 (`plan/admin-theme/ADMIN_THEME.md`
revs 2-5 and the Claude Design cards); what needs a look here is how it lands on the real
screens.

Regions, states and interactions are unchanged from `docs/wireframes/admin-shell.md`
(signed off 2026-07-21), so this is an appearance re-sign, not a wireframe re-sign. Task
031's set (`docs/gates/031/`) is the before shot.

Each of four screens is captured at 390px (`-390.png`) and 1280px (`-1280.png`) in all
three modes (`-light-`, `-dark-`, `-hc-`): 24 frames, from the real screens through the e2e
harness, with the Next dev-tools indicator removed. The mode is set the way an operator's
browser sets it, through the `qcms-app-mode` cookie the root layout reads.

| File | What to approve |
| --- | --- |
| `sign-in-<mode>` | The auth card away from the shell: 8px card corner, the layered soft shadow (absent in HC by design), 4px controls at 40px, the cobalt submit, and the QCMS wordmark under the card. |
| `2fa-challenge-<mode>` | The same card language carrying a single field and a secondary link. |
| `shell-questions-<mode>` | The topbar: translucent and mode-following in Light and Dark, solid behind a strong border in HC; the QCMS wordmark with **no sub-label**; the accent underline on the active nav item; the mode control; and how the whole bar wraps at 390px. |
| `shell-settings-<mode>` | Three stacked cards, the dense 40px form controls, and the semantic success/warning text on the 2FA status line. |

What the theme deliberately does **not** do, so it is judged for what it is:

- **No respondent theming.** Portal themes (slate/harbor/sand/plum) are the adopter's
  choice for respondents; this app always wears the brand cobalt. Only the mode changes.
- **No font or density switcher.** One face (Lexend), dense by default. Operators get the
  mode control and nothing else on this axis.
- **High-contrast is never inferred.** It appears in these frames only because the capture
  chose it. Nothing in the app resolves `prefers-contrast` to HC, unlike the portal.
- **The area screens are still placeholders** (Questions, Forms, Responses, Webhooks) until
  tasks 032-035. `shell-questions` shows one, now wearing the theme.

Regenerate this set with:

```
QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots
```
