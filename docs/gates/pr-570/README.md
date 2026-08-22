# Gate: issue 570, the kit tables get real anchors

**Approve that the four converted tables read correctly with a link in the identifying cell instead of a clickable row, and that the columns each one drops at 390px are the right ones to lose.**

## The frames

Eight PNGs, four screens at 390px and 1280px. Light mode only: this change moves markup
and columns rather than colour, and the link treatment it introduces (`.qcms-text-link`)
is the one every other table in the app already wears, reviewed in all three modes under
`docs/gates/pr-514/`.

| Screen | Frames | What changed |
|---|---|---|
| Question library | `questions-table-390.png`, `questions-table-1280.png` | The ID cell is a link. Type and Created drop at 390. |
| Form library | `forms-table-390.png`, `forms-table-1280.png` | The Slug cell is a link, the form id keeps a column. Locale drops at 390. |
| Version history | `version-history-390.png`, `version-history-1280.png` | The Version cell is the view link; the separate list of "View v1" links under the table is gone. The three engine stamps drop at 390. |
| Library picker | `library-picker-390.png`, `library-picker-1280.png` | Each choosable row carries an Add button named for its question and version; a row that cannot be pinned carries none. Type drops at 390. |

The Version column never drops anywhere (`plan/admin-mobile-stance.md`, item 5).

## What is not in a frame

The behaviour this change exists for does not photograph. Open-in-new-tab, middle-click
and operation with scripting switched off are evidence rather than appearance, and they
are in `apps/admin/e2e/table-anchors.pw.ts` (a browser with `javaScriptEnabled: false`
following a link in each of the three navigating tables) and
`apps/admin/app/(shell)/table-anchors.test.tsx` (the anchor present in the server HTML
with a resolvable `href`). `red-first.txt` in this directory is the same suite measured
against the components before the change.

## How the frames were made

```
QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
  --project=admin-chromium apps/admin/e2e/gate-screenshots-pr-570.pw.ts
```

Dev chrome hidden, full page, caret suppressed, every frame taken from a fresh load at its
own viewport. The question and form libraries are scoped to the run's own fixtures so the
frames are a readable handful of rows rather than whatever the harness database has
accumulated; the version history is the seeded insurance form, which is already published.
The blank line at the bottom of every frame is the signed-in operator's address, which the
suite mints per run.
