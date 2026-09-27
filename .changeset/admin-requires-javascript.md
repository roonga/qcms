---
"qcms-admin": minor
"create-qcms-app": minor
---

The admin requires JavaScript, and says so instead of serving a shell that cannot work
(Code Owner, 2026-09-27). With scripting disabled, every admin route renders one message -
"JavaScript is required", and how to proceed - and nothing else is visible, announced or
focusable: no sign-in form, no topbar, no nav, no rail, no table. With scripting on nothing
changes and there is no flash.

**The check is in the root layout and there is no second place to put it.**
`apps/admin/app/layout.tsx` is what every admin route renders through, sign-in included, so
one gate there covers the app; a check on the shell layout or the sign-in page would leave
the other side of the auth boundary open, and neither side alone would notice. Below the
layout there is nothing to check, because no admin screen has a scriptless mode to fall back
to.

**A `<noscript><style>` block, which needs no CSP change.** `lib/server/csp.ts` already
grants `style-src 'self' 'unsafe-inline'` because Tailwind injects a stylesheet, so an
inline `<style>` is allowed as it stands - a hash would have to be recomputed by hand on
every edit to the rule, and the nonce this app threads is for `script-src` and deliberately
never reaches React. Nothing script-shaped is introduced, which matters more than it sounds:
a gate written in JavaScript is the one thing that cannot run in the case it exists for. The
message is rendered on every page and hidden by `globals.css`, a stylesheet in `<head>`, so
a scripted operator never paints it rather than having it removed after the first frame.
`display: none` on the hidden half, because "not usable" means out of the tab order and out
of the accessibility tree, and that one property does both.

**This reverses a standing correction rather than restating one.** On 2026-08-22 the Code
Owner recorded that there is no no-JS requirement in the admin; this says the opposite thing
is a requirement, which settles the same questions by removing the case. No-JS remains a
**portal** requirement and is untouched: `docs/PROJECT_GOAL.md` scopes it to the browsers a
respondent runs, and neither `apps/portal` nor `@roonga/qcms-ui` changes here.
`plan/admin-design-contracts.md` carries the dated ruling.

**What is now unreachable and is deliberately still there.** The auth route handlers stay
(ADR-35 / SEC-1 keep that flow as named server routes rather than client JavaScript, which
is an argument about the endpoint set and not about scripting). The plain POST sign-out form
in `components/account-menu.tsx` and the `/sign-out` route stay, because the scripted menu
item is what submits that form - one sign-out path in the app, not two. What is gone is the
`<noscript>` rule that used to reveal that form and hide the two topbar menu triggers (the
2026-07-31 no-JS sign-out decision), because the shell it sits in is never on screen without
scripting. Whether a scriptless way to end a session should exist in another shape is left
for the Code Owner rather than answered here.

**Four existing specs contradicted the requirement and each one was read rather than
swept.** `auth-2fa.pw.ts`'s scriptless sign-out walk and `table-anchors.pw.ts`'s scriptless
row-click walk are deleted: the first is unreachable step by step, and every assertion in the
second is already made with scripting on by the keyboard walk in the same file. `rail.pw.ts`
is converted - its anchors claim never rested on scripting and is kept, while its "the
disclosure opens with nothing loaded" half is dropped as the scripting-shaped one, already
covered scripted in the same file. `hydration-wait.pw.ts` keeps its claim, that the hydration
wait returns at once where React is never coming, and observes the message rather than the
sign-in form; the early return it pins now protects the next scriptless spec somebody writes
instead of a shipped path.
