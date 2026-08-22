# Gate: the content column and top nav left-anchor, and the caps match their POCs (issues 648, 657)

Approve two changes that are visible on every authenticated screen, against the POCs in `plan/admin-shell-poc/`:

1. **Nothing is centred and the chrome is no longer capped.** The topbar carried `mx-auto max-w-5xl`, which put the wordmark about 145px in from the page edge at 1280 while the content column beside a rail started at the rail. Every POC that draws the shell (ten of the eleven; `auth-poc.html` drops the shell deliberately) writes `.topbar__inner` with neither a `max-width` nor an auto margin, so both come off the bar and off the footer, and the wordmark, the first nav item, the content column and the footer share one left edge. Where a rail is present the column begins at the rail's edge instead.
2. **Each route's cap is the one its own POC draws.** Ten of the sixteen screens move.

| Frame | Viewport | What to approve |
| --- | --- | --- |
| `webhooks-1280.png` | 1280 | 648: no rail, so the wordmark, the first nav item, the column and the footer share one left edge. 657: 1820, `deployment-ops-poc.html` `.ops-inner--webhooks`, up from 1600 |
| `webhooks-390.png` | 390 | 648 on a phone: the anchoring is all that changed, because a cap is fluid below itself |
| `form-responses-1280.png` | 1280 | 648 with a rail: the column starts at the rail's edge. 657's largest widening: 1600, `responses-poc.html` `.main`, up from 1024 |
| `form-responses-390.png` | 390 | 648 below `--bp-sidebar`: the rail is a disclosure stacked above a full-width column |
| `settings-1280.png` | 1280 | 648: the 40rem column hard against the Settings rail (`settings-newquestion-poc.html` `.page-main`, `margin: 0`) |
| `settings-390.png` | 390 | 648 at 390: rail stacked, column fluid |
| `questions-new-1280.png` | 1280 | 657's largest narrowing: 640, `settings-newquestion-poc.html` `.page-main`, down from 1024 |
| `question-detail-1280.png` | 1280 | 657: 720, `question-editor-poc.html` `.editor-column`, down from 1024 |
| `responses-1280.png` | 1280 | 657: 900, `deployment-ops-poc.html` `.ops-inner--responses`, down from 1024 |
| `erasures-1280.png` | 1280 | 657: 1180, `deployment-ops-poc.html` `.ops-inner--erasures`, up from the same 1024 |
| `forms-1280.png` | 1280 | 657: 1080, `library-lists-poc.html` `.main`, up from 1024 |

Captured by `apps/admin/e2e/gate-648.pw.ts`, one frame per test, against the seeded insurance fixture with one submitted response.

One deviation from the POCs is deliberate and is called out in the PR body: the POCs pad both the topbar and the main column by 1.25rem, and these frames pad both by the shipped 1.5rem. The shared left edge is the same either way; matching on 1.5rem avoids moving every screen's content padding, which neither issue asks for.
