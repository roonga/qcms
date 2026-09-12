---
"@roonga/qcms-ui": minor
---

Declare the font fallback tails once, as `--font-fallback-sans`, `--font-fallback-serif`
and `--font-fallback-mono`, and add `--font-mono` to the typography group (issue #27).

A fallback stack is what a respondent reads when the primary face is missing, refused
or still downloading, and it is invisible on every machine that HAS the face - which is
every machine an author tests on. So a second copy of the list never looks wrong and
never gets corrected. `theme.css` now carries the three lists and nothing else does:
`--font-portal` is `var(--font-fallback-sans)`, `--font-mono` is
`var(--font-fallback-mono)`, and every registry entry renders as
`"Family", var(--font-fallback-sans)` instead of restating a tail of its own. One edit
to a tail now reaches all 23 entries and both surfaces.

The sans tail also grew the broad-coverage and emoji faces a device is likely to have
(`"Helvetica Neue"`, `"Noto Sans"`, `"Liberation Sans"`, `Arial`, then the four
emoji/symbol families after the generic, as Bootstrap 5's Reboot does), so a codepoint
no earlier face carries renders instead of a `.notdef` box. `system-ui` stays in the
list but never leads it: it resolves from the OS/UI locale rather than the content
language.

**Import order now matters in one more way.** `fonts.css` referenced its tails as
literal lists and now references them as `var()`, so it must be imported after
`theme.css` - which the contract already required, since a `.font-<key>` block has to
override the base `--font-portal` to do anything. An adopter who imports `fonts.css`
alone now gets a `font-family` that is invalid at computed-value time rather than a
silently wrong face. `FontEntry.stack` values changed shape accordingly.
