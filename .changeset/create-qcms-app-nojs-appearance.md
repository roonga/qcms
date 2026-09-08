---
"create-qcms-app": minor
---

Scaffold the portal's no-JS appearance form, so an adopter's respondents can pick a
colour mode, a font and a spacing level without JavaScript (issue #195).

The templates are generated from `apps/portal`, so this is the scaffolded half of the
same change: a new `app/appearance/route.ts`, a new `lib/server/appearance-form.ts`, and
the appearance controls rendered inside a real `<form method="post">` whose Apply button
is revealed by the `<noscript>` rule in `app/layout.tsx`. The route validates the three
values against the same enumerations the controls offer, writes the same three cookies
through the same writer the browser path uses, and redirects only to a path inside the
adopter's own portal origin.

Nothing an adopter configures changes. `QCMS_PORTAL_MODE`, `QCMS_PORTAL_FONT`,
`QCMS_PORTAL_FONTS` and `QCMS_PORTAL_DENSITY` still decide the defaults; this only gives
a respondent with scripting off a way to override them, which previously did not exist
at all because the whole disclosure was hidden.

The scaffolded route validates the return path against the URL parser's normalised output,
not the string it was handed, and emits its `Location` absolutely on the adopter's own
configured base. A candidate like `/..//evil.example` has one leading slash and normalises
to the pathname `//evil.example`, which a browser reads as protocol-relative; that was a
real open redirect in the first cut of this work and is closed here twice over.
