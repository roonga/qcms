# Gate: the rules section is called Rules (issue 661)

Approve that the builder's rules section is headed **Rules**, agreeing with the "Add rule" button beside it, the `Rule rul_...` cards under it and the Rule test bench next to it, and that the word "condition" is still used where it names the `when` half of a rule (the "Condition JSON" pane, the "When" fieldset, the empty and no-pin notes). It used to read "Conditions", which named the section after one part of the things it lists.

| Frame | Viewport | What it claims |
| --- | --- | --- |
| `builder-390.png` | 390 | The Code Owner's standing narrow width: the heading, its button and the rule cards stacked in one column |
| `builder-1280.png` | 1280 | The desk width: the heading beside its button, with the validation panel alongside |

The POC for this screen draws `<h2 class="stacked-heading">Rules</h2>` in `plan/admin-shell-poc/admin-shell-poc.html`, which is what these frames are checked against.

Captured by `apps/admin/e2e/gate-661.pw.ts`, one frame per test, against the seeded `frm_auto_quote` fixture: the heading is only worth a frame with rules under it.
