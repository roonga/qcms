# Gate: the Settings rail, as the written exception it is (issue 562)

Approve the Settings rail against `plan/admin-design-contracts.md` §7a: same-page section anchors for one route and nothing else (no routes, no actions, no counts), a 240px column at and above `--bp-sidebar` and a disclosure below it whose summary names the active section, a distinct component from the §7 form-subtree rail with no shared abstraction extracted between them, and the screen's own width unchanged (the audit calls Settings the clearest reject on width in the app).

| Frame | Viewport | Clause it claims |
| --- | --- | --- |
| `settings-390.png` | 390 | §7a collapsed: below `--bp-sidebar` the rail is a disclosure, shown open, naming no section because the URL names none |
| `settings-390-shut.png` | 390 | §7a's summary clause: shut, at `#two-factor`, the summary naming the active section |
| `settings-1023.png` | 1023 | §1 / §7a: one pixel below the boundary, still a disclosure |
| `settings-1024.png` | 1024 | §1 / §7a: at the boundary, the 240px column beside the content, three section links, no divider and no badge |
| `settings-1280.png` | 1280 | §7a at the standing wide width, with the password forms still capped at `max-w-sm` |
| `settings-1280-active.png` | 1280 | §7a's active mark: at `#change-password`, that row alone carries the accent edge and the heavier weight |

The active section is the fragment in the URL, marked by `:target` in `app/globals.css` and carrying no script, which is why two frames arrive by anchor. Captured by `apps/admin/e2e/gate-562.pw.ts`, one frame per test.
