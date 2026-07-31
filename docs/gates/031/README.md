# Gate evidence - task 031 (admin shell and 2FA auth)

Approve the admin's visual design and the auth-flow states against
`docs/wireframes/admin-shell.md` (signed off 2026-07-21). Each state is captured at 390px
(`-390.png`) and 1280px (`-1280.png`) from the real screens through the e2e harness, with
the Next dev-tools indicator removed.

What to look at, in the order an operator meets it:

| File | Wireframe state | What to approve |
| --- | --- | --- |
| `sign-in` | signed-out | The card, the two fields, the submit button - and the **absence** of any registration affordance (SEC-1). |
| `sign-in-error` | sign-in error (generic) | One generic sentence that names neither the email nor which field was wrong, in a focused alert. |
| `sign-in-throttled` | sign-in throttled | The generic "try again later" alert. |
| `session-expired` | session-expired | The "your session expired" alert on the sign-in screen, rather than a silent logout. |
| `2fa-enroll` | 2FA-enroll | QR code plus the labelled, readable manual setup key beside it (the accessible alternative, not a fallback). |
| `recovery-codes` | recovery-codes-display (one-time) | Ten codes as a readable list in tabular monospace, the "only time they are shown" wording, and the confirm button that gates continuing. |
| `2fa-challenge` | 2FA-challenge | The code field, the verify button, and the "use a recovery code instead" link. |
| `2fa-challenge-error` | 2FA-challenge (failed) | The same generic sentence as a wrong password. |
| `2fa-recovery-entry` | 2FA-recovery-entry | The recovery-code variant and its link back to the authenticator app. |
| `shell-questions` | authenticated | The top bar: QCMS Cobalt accent, the five nav items, the visibly active item, the sign-out control - and how the bar wraps at 390px. |
| `shell-settings` | authenticated (Settings) | Account, change password (with the "signs out every other session" warning), and 2FA status. Nothing else: RBAC and user management are Phase 4. |

Two things are deliberately not in the wireframe as drawn:

- **The area screens** (Questions, Forms, Responses, Webhooks) are placeholders: a heading
  and one dashed-outline line naming the task that fills them (032-035). `shell-questions`
  shows one. They exist so the shell is navigable and so an empty area does not read as a
  bug during this review.
- **No "copy all" button on the recovery-code screen.** The wireframe lists one; it needs
  client-side clipboard access plus a status region, which is a client interaction pattern
  the admin has no other use for yet. Selecting the visible list works today with keyboard
  and mouse. Flagged for the Code Owner to accept or send back.

Regenerate this set with:

```
QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots
```
