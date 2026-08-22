# Gate: the validation panel says what it knows, not what it has not checked (issue 625)

Approve the two states the builder now distinguishes beside the Publish button: a draft nothing has checked, and a draft a dry run has just reported on.

| Frame | The clause it claims |
| --- | --- |
| `unchecked-390.png` | `plan/admin-ux-audit.md` §5.6: the panel is the screen's single authoritative issue count, so before a check it states that it has none rather than rendering the zero it was seeded with. At this width the pin grid's Issues column has dropped (`plan/admin-design-contracts.md` §2), so the sentence is the whole of the claim. |
| `unchecked-1280.png` | §5.6 with §2: the same sentence, plus the Issues column reading `Not checked` per pin instead of `None`. One screen, one answer. |
| `checked-390.png` | The control: one change later, a real count from a real dry run. **This frame is 511px wide, not 390.** |
| `checked-1280.png` | The control at the standing wide width: the count, the issue against the pin it names, and the step rail's badge, all from the same verdict. **This frame is 1406px wide, not 1280.** |
| `seeded-1280.png` | The form this issue was filed on, shot again after the fix, for frame-to-frame comparison with `docs/gates/pr-561/builder-1280.png` (the same screen claiming "No issues. Everything here would pass a publish.") and `docs/gates/pr-561/versions-1280.png` (the §7 rail badging `2 issues` on the same draft). |

## The two frames that are wider than their names

`checked-390.png` and `checked-1280.png` are shot in a state that overflows its viewport by about 147px at both widths: once the validation panel has an issue ENTRY to draw, the builder's outer column takes its width from one unbreakable token. It is filed as issue 643 and it predates this change - the same measurement against `main` before this branch gives the same 511px - and this change alters no markup in that state. `apps/admin/e2e/gate-625.pw.ts` names the allowance on exactly those two frames, and both the allowance and this section come out in the change that fixes 643.

The three frames without that note are the width their names claim.

Shot by `apps/admin/e2e/gate-625.pw.ts`, one frame per `test`, against a form built through the app with a deprecated pin (`apps/admin/e2e/support/rail.ts`) and, for the last frame, the seeded insurance form read without writing to it.
