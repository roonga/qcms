# Gate: issue 683 - the recovery codes can be copied

What to approve: that an operator standing in front of ten codes they will never see again
can tell, without being told, **whether the copy worked**. Both POCs that draw this screen
(`plan/admin-shell-poc/auth-poc.html`, `plan/admin-shell-poc/settings-newquestion-poc.html`)
draw the same control in the same place with the same two sentences: a secondary "Copy
codes" button between the list and the confirm, with a status line beside it.

The frames to look hardest at are `copied` and `failed`. The idle frames show a button,
which is easy to agree with; what cannot be checked any other way is what the status line
**says** once it has something to say, and that it says something at all when the write
never happens. A copy control that fails quietly is worse than no control, because the
operator walks away believing they hold the credential of last resort.

`failed` is the absent-clipboard case (an insecure context, or an older engine). A refused
write produces the identical sentence and so is not shot twice: the cause differs, the
remedy does not, and the sentence names the remedy.

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`), against a real
enrollment driven through the app, so the codes shown are genuine one-time codes belonging
to throwaway harness accounts. Captured by `apps/admin/e2e/gate-683.pw.ts`, one state per
test, which runs only with `QCMS_ADMIN_CAPTURE_GATE=1`. Each test asserts the status line's
exact text before the shutter.

| Frame | What it claims |
| --- | --- |
| `reveal` | The screen as it arrives: the ten codes, the copy control, and a status line that is present and **empty**. Empty is the claim - a live region that arrives with text already in it is not announced, so nothing may be said before there is something to say. |
| `copied` | After a successful copy: "Codes copied." beside the button. The codes stay on screen; the announcement is an outcome and never a code. |
| `failed` | With no clipboard to write to: "Could not copy automatically. Select the codes above and copy manually." The list above is still there, which is the remedy that sentence points at. |
