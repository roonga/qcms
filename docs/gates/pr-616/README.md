# Gate: the builder fits its viewport (issue 616)

Approve that the builder is legible at 320 and 390 now that it no longer scrolls sideways, and that nothing about it changed at 1280. The version state tag wraps under the control it describes instead of sitting beside it on an unbreakable line, and a rule card scrolls inside its own border rather than pushing the page.

| Frame | Viewport | What it claims |
| --- | --- | --- |
| `builder-320.png` | 320 | WCAG 2.2 AA SC 1.4.10 Reflow at the width the criterion names. The document was 391px here, seventy-one past the viewport |
| `builder-390.png` | 390 | The Code Owner's standing narrow width, where the document was 391px and is now 390 |
| `builder-1280.png` | 1280 | The desk width, where this change is meant to be invisible |

Captured by `apps/admin/e2e/gate-616.pw.ts`, one frame per test, against the seeded `frm_auto_quote` fixture. That fixture is the point: it carries a version state tag and a rule card, which are the two things that made the page too wide, and which the builder's existing 390 measurement in `pin-grid.pw.ts` never had on screen.
