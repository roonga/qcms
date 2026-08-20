# Gate: issue 514 - one table family, one empty state

What to approve: that the app's **nine tables now read as one table**, and that every
**"nothing here" now reads as one panel**, against `plan/admin-design-contracts.md` §2
and §3 (CONFIRMED 2026-08-20) and the frozen card `plan/admin-theme/ds-table.html`.

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`). Captured by
`apps/admin/e2e/gate-514.pw.ts`, which runs only with `QCMS_ADMIN_CAPTURE_GATE=1`.

## The tables (§2)

| Frame | The clause it carries |
|---|---|
| `questions-table-light` | One class family over the **vendored kit table**: 44px rows, 0.72rem header on a strong-border underline, 0.4rem/0.6rem cells, no zebra. Compare with any hand-authored table below: that they match is the whole point. |
| `forms-table-light` | The same, on the second kit table. |
| `version-history-table-light` | The same, on the kit table whose rows deliberately do nothing. The hover affordance is now opt-in, so this table simply does not ask for it (the `qcms-table--static` opt-out retires). |
| `responses-table-light` | One family on hand-authored markup, plus the **compact-width clause**: at 390 the answer-preview column is gone and the table is the five identifying columns, with no sideways scroll. |
| `erasures-table-light` | One family; Reason drops at compact width. |
| `webhooks-table-light` | One family with controls in its cells; Secret and Created drop at compact width. |
| `deliveries-table-light` | One family with an expandable row; Latency drops at compact width. |
| `dead-letters-table-light` | One family; Last error drops at compact width. |
| `links-table-light` | One family on the secure-link lifecycle table; Minted drops at compact width. The issue flagged this table as the likeliest bad fit for the card's shape, and it is not one: the one-time reveal is the minted-links panel, a list, not this table. |

Also visible in every one of these frames: `tabular-nums` is now on **numeric and stamp
columns only**, not on every cell of every table.

## The empty states (§3)

| Frame | The clause it carries |
|---|---|
| `erasures-empty-light` | The panel with **no CTA**, on a screen with no creating action: centred, 1.5px dashed `--color-border-strong`, surface background, an `h2`, one sentence. |
| `webhooks-empty-light` | The panel **with a primary CTA**, on a screen that has a creating action. |
| `questions-filtered-empty-light` | The **filtered variant**: panel kept, heading swapped to the screen's "no matches" line, explanatory sentence dropped, clear-filters kept as the CTA. |
| `responses-filtered-empty-light` | The same filtered variant on a different screen. The app used to handle filtered-vs-unfiltered two different ways on these two screens. |

## The mode layers

| Frame | Why |
|---|---|
| `questions-table-dark`, `questions-table-hc` | The dividers, the header underline and the row rhythm in the other two mode layers. |
| `webhooks-empty-dark`, `webhooks-empty-hc` | The 1.5px dashed `--color-border-strong` panel edge, which is the only genuinely new painted thing in this change. |

The full set is shot in light only. Every colour here is an existing token that all three
mode layers already define and that gates 032, 034 and 035 already signed off on these
same screens; what is new per mode is the dashed panel edge and the header underline, and
the four frames above carry both.

## Not in the set, and why

The **unfiltered** question-library and form-library empty panels, and the **secure-links**
empty panel. Reaching the first two needs a database with no questions and no forms, and
the third needs a published form with no links against it; this harness runs on the seeded
fixture and offers none of the three reliably. The library panels are pinned structurally
instead, in `apps/admin/app/(shell)/empty-and-table-states.test.tsx`, and the four empty
panels above already carry both of §3's variants and both its with-CTA and without-CTA
shapes.
