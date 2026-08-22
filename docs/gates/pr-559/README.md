# Gate: the form-subtree rail (issue 559)

Approve the rail on the secure-links reference screen against `plan/admin-design-contracts.md` §7: two groups (the form's steps with their issue badges, then its six sibling routes) separated by one divider, anchors only with no actions, a 240px column at and above `--bp-sidebar` and a disclosure below it whose summary names the active item, and the rail's surface reaching the bottom of the shell on a screen shorter than the viewport (N2).

| Frame | Viewport | Clause it claims |
| --- | --- | --- |
| `links-390.png` | 390 | §7 collapsed: below `--bp-sidebar` the rail is a disclosure, shown open |
| `links-390-shut.png` | 390 | §7 collapsed and shut: the summary names the active item ("Links") |
| `links-1023.png` | 1023 | §1 / §7: one pixel below the boundary, still a disclosure |
| `links-1024.png` | 1024 | §1 / §7: at the boundary, the 240px column with both groups and the divider |
| `links-1280.png` | 1280 | §7: both groups, the per-step issue badge, and the current row marked |
| `links-1280-tall.png` | 1280 x 1600 | N2: the rail's surface and border reach the bottom of the shell |

Captured by `apps/admin/e2e/gate-559.pw.ts`, one frame per test, against a form built through the app (`apps/admin/e2e/support/rail.ts`).
