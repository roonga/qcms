---
"qcms-admin": minor
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

**The auth route handlers stay exactly as they are** (Code Owner, 2026-09-27). Sign-in, the
2FA challenge and enrollment, and both recovery screens keep their plain forms posting to
named server routes, because ADR-35 / SEC-1 are about a credential, a TOTP code and a
recovery code never passing through client JavaScript - not about no-JS support. That reason
is untouched, so the handlers are untouched. What changes is that nothing reaches them with
scripting off, and the spec says so about all five screens by visiting each directly rather
than walking to it: a screen that is unreachable only because the step before it is
unreachable would still be submittable to anyone who typed its address.

**The no-JS sign-out affordance is REMOVED** (Code Owner, 2026-09-27, superseding the
decision of 2026-07-31). That decision kept a plain POST sign-out button rendered on every
page, which a `<noscript>` rule revealed while hiding the two topbar menu triggers, so a
scriptless operator could still end a session. It was a control nothing could show once the
shell it sat in stopped being reachable, so the button, its CSS and the `<noscript>` rules
are all gone. The POST form itself stays in `components/account-menu.tsx`, carrying `hidden`
instead of a class, because `requestSubmit()` on it is how the scripted menu item signs out
and sign-out is a POST rather than a GET for the reason SEC-1 always gave; `/sign-out` is
unchanged.

**The pairing those two decisions depend on is asserted, not assumed.** A scriptless operator
holding a session with no way to end it would be a defect, so the reason it cannot arise -
that they cannot sign IN either - is a named claim in the spec rather than a remark in a
comment.

**Two contract clauses lose a justification that expired.** §2's row-action clause read "a
real anchor (open-in-new-tab and no-JS work)" and now reads "(open-in-new-tab and
middle-click work)": the element and the argument for it are unchanged, since both of those
are the browser acting on an `href` and a row that merely reacts to a click has none. The
five comments that quoted the clause were corrected with it.

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
