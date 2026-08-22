# Gate: the Settings screen rebuilt to its POC (issue 655)

Approve the Settings screen against `plan/admin-shell-poc/settings-newquestion-poc.html`, which is the approved design: three panels with exactly one on screen and the other two `hidden`, a rail of buttons that switches between them and carries `aria-current="page"` on the one showing, an `<h1>` that names the selected section rather than the screen, a rail summary reading "Settings", and a main column capped at 40rem and left-anchored rather than centred.

| Frame | Viewport | What it claims |
| --- | --- | --- |
| `settings-390-account.png` | 390 | The panel the screen opens on, below `--bp-sidebar` where the rail is a disclosure stacked above the column |
| `settings-390-password.png` | 390 | The switch at 390: the password panel up, the account line gone rather than scrolled past, the heading renamed |
| `settings-390-twofactor.png` | 390 | The two-factor surface alone at 390, which is the longest of the three and the clearest case for separating them |
| `settings-1280-account.png` | 1280 | Account at the standing wide width: the 240px track, and the 40rem column left-anchored against it rather than centred |
| `settings-1280-password.png` | 1280 | The switch at 1280, with the marked rail row and the renamed heading both in frame |
| `settings-1280-twofactor.png` | 1280 | Two-factor at 1280, the panel that used to sit two screens down the same scroll |

The switch is driven by JavaScript, which the POC's own design requires (`onclick`, `hidden`, and a heading rewritten on selection). No scriptless fallback was added: that floor belongs to the respondent portal. Captured by `apps/admin/e2e/gate-655.pw.ts`, one frame per test, so `--grep settings-1280-password` re-shoots exactly one.

This gate supersedes `docs/gates/pr-562/` for this screen. Those frames stay as the record of the stacked design that preceded it.
