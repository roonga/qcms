---
"create-qcms-app": minor
---

Scaffolded apps format with an operator-set locale and show honest time zones (Code Owner ruling 2026-10-19).

Both scaffolded apps read `QCMS_LOCALE` (a BCP 47 tag, default `en-GB`) for dates, times, numbers, list formatting and date-field segment order, instead of the bare `en` that `Intl` reads as United States conventions. An invalid tag refuses to boot, naming the variable and not the value. The portal's no-JS date fallback is three boxes in that order, so the server render and the hydrated date field agree, and the receipt's submitted time moves to the respondent's own clock, zone named, once the page hydrates. Admin times are shown on the operator's own clock everywhere, never as a UTC first render; the response filters, the export range and a secure link's expiry read their days on that same clock and name it.
