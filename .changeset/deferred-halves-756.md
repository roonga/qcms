---
"qcms-admin": patch
"qcms-api": patch
"qcms-portal": patch
---

Land the two remainders #755 deferred: the reason a webhook URL was refused, and a gate
that keeps the message catalogs swept (issue #756, from #312 and #538).

**The webhook rejection reason.** `ops.error.webhookUrlRejected` said one sentence for
four different mistakes, so an author who mistyped a scheme and an author who pointed at
a private address were told the same thing and neither learned which rule they had broken.
#312 deferred it as a plumbing decision - surfacing the reason looked like an `ApiResult`
shape change touching every caller. That decision had already dissolved: issue #823 gave
`messageForFormCode` a context record and the envelope reader already reads `details`, so
the whole change is one optional field and no caller moves. The API has carried
`details.reason` on its 422 since task 024 and nothing read it; the admin now maps that
closed enum of four onto four catalog sentences and falls back to the general one for a
reason it does not recognise, so a fifth reason added across the app seam degrades rather
than blanks. What it deliberately does not do is render the envelope's `message`: that is
developer English outside ADR-27's catalog, and putting an API response body in front of
an operator is what SEC-8 exists to stop.

In the same function, the API's own prose for two of those reasons ended "set
QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets". That is a flag value in a response body,
and ADR-24's "clients receive behavior, not flag values" has been absolute since the Code
Owner removed its one standing exception on 2026-08-31. Both now state the behaviour.

**The dead-key gate.** `pnpm check:dead-i18n-keys` fails when a message catalog defines a
key nothing renders. The other direction needs no gate and never did: both catalogs are
`as const` and `t()` takes `keyof typeof messages`, so a key that does not exist is a type
error at the call site, which is what #538 asked someone to check before building it.

It parses rather than greps, because #755 measured the regex version and rejected it: a
`t(` plus backtick pattern matches a `formPost(` call in a portal test, and a text scan
reads `expect(source).not.toContain("forms.section.heading")` - an assertion that a key is
absent - as a reference to it. The parser is the `typescript` package already in the
toolchain, so no dependency moves. A reference is any string literal equal to a key
anywhere in that catalog's own app outside a test, which covers the `Record<string,
MessageKey>` tables and `MessageKey` props without modelling either; a literal that is a
prefix of a key counts too, which is how the twenty-four dynamic prefixes in this
repository keep their keys alive. Catalogs are found by their shape rather than their
path, so this is scoped once across apps rather than per app, and a third app's catalog is
in scope on the day it lands.

It found exactly the two keys #756 predicted and nothing else, across 1083 keys in two
catalogs. Both are deleted: `recovery.action` was written for a screen that renders a
title and a body and no action, and `completion.copy` for a copy control the completion
screen has never had. Each deletion leaves a comment saying what would bring the string
back.

Also folded in, because #756 named it: the docblock on the admin's form page header still
described composing a `forms.section.heading` template that #538's sweep deleted.
