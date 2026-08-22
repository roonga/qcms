# Gate: the section routes name their section in the h1 (issue 679)

What to approve: that a form's five section screens now tell each other apart by their one
landmark heading, reading **`{section}: {slug}`**, and that the builder's heading is
deliberately not one of them.

Six sibling screens of one form used to render the same `<h1>`, the form's slug. The
approved drawing for two of them composes both parts already
(`plan/admin-shell-poc/preview-versions-poc.html`: "Draft preview: Life insurance",
"Version history: Life insurance"). The connector is a colon and not a preposition because
the six section names are already catalogue keys, so a colon composes them with one template
and two placeholders while "Responses **to** X" but "Links **for** X" would hand-write
English grammar into five strings (ADR-27).

The seeded fixture `frm_auto_quote` is what the frames are shot against, so the slug after
each colon reads **`auto`**.

## Two things to look hardest at

**The version list is now called "Version history", not "History".** It is the only label
this change renames. "History" was the one name in the six that did not say what it listed,
and composed into a heading it read as the form's edit history rather than its published
versions. The app's own prose already called it version history in both links that point at
it ("View version history", "Back to version history"). The rail carries the screen's name by
`plan/admin-design-contracts.md` §7's own amendment, so the rail followed. Look at
`versions-1280`: the rail is a 15rem column and this is the longest label in it.

**The builder is in frame and is unchanged.** `builder-390` and `builder-1280` still read
`auto` with nothing in front of it. That is the decision, not an omission: the `<h1>` names
the page's subject, and on the builder the subject is the form. It is exempt by construction,
because it is the one route of the six that does not render `FormPageHeader`.

## Frames

Every screen is shot at **390px and 1280px** (`-390.png` / `-1280.png`). Captured by
`apps/admin/e2e/gate-679.pw.ts`, one frame per test, which runs only with
`QCMS_ADMIN_CAPTURE_GATE=1`. Each test asserts its heading text before the shutter.

| Frame pair | Heading it claims |
| --- | --- |
| `preview-*` | `Preview: auto` - drawn in the POC as "Draft preview: Life insurance" |
| `versions-*` | `Version history: auto` - drawn in the POC, and the one section renamed |
| `links-*` | `Links: auto` - no drawing of its own; the construction governs it |
| `responses-*` | `Responses: auto` - the section whose other POC drew a preposition |
| `webhooks-*` | `Webhooks: auto` - no drawing of its own |
| `builder-*` | `auto` - the bare slug, kept on purpose |
