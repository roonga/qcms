---
"create-qcms-app": minor
---

Scaffold the admin's JavaScript-required gate, so an adopter's operators meet one clear
message instead of a shell that cannot work (Code Owner, 2026-09-27).

The templates are generated from `apps/admin`, so this is the scaffolded half of the same
change. `app/layout.tsx` carries a `<noscript><style>` block that hides every other child
of `<body>` and reveals a catalogued message saying the app needs JavaScript and to enable
it and reload; `app/globals.css` holds the default that keeps the message hidden, and
`lib/i18n/en.ts` holds the two strings (ADR-27). Nothing else on the page is painted,
announced or focusable in that state, including the sign-in form.

Nothing is scaffolded that an adopter has to configure. The gate passes the scaffolded
Content-Security-Policy exactly as generated - `lib/server/csp.ts` already grants
`style-src 'self' 'unsafe-inline'` for Tailwind, so no hash and no nonce is involved - and
no script of any kind is added, which keeps the scaffolded `script-src` free of an
allowance the template would then have to explain.

**One scaffolded affordance is removed with it.** The generated
`components/account-menu.tsx` carried a plain POST sign-out button that a `<noscript>` rule
revealed, so an adopter's scriptless operator could still end a session. It is gone, because
the shell it sat in is no longer reachable without scripting (Code Owner, 2026-09-27,
superseding 2026-07-31). The `hidden` POST form and the `/sign-out` route behind it stay:
that is what the scripted menu item submits, and sign-out is a POST rather than a GET for
the reason SEC-1 gives. The scaffolded sign-in, 2FA and recovery screens are untouched -
their plain forms exist so a credential never passes through client JavaScript (ADR-35 /
SEC-1), which no ruling about scripting changes.

**The scaffolded comments came with it.** The generated admin carried about two dozen
comments giving "works with JavaScript off" as the reason for an element choice, describing
the frame before React attaches as a no-JS state, or presenting the auth flow's native form
POSTs as no-JS support. Each now says what it means, which matters more in a template than
in our own tree: an adopter reads these comments as the rationale for code they own, and a
reason that is no longer true is worse than no comment at all.

**The scaffolded portal is unchanged, and the asymmetry is deliberate.** No-JS is a
respondent requirement, so the portal templates keep every scriptless path they have; the
admin is an internal authoring tool and now requires scripting. An adopter reading both
apps at once will find the two answers side by side, and the comment in the generated
`app/layout.tsx` says which is which.
