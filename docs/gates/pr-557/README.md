# Gate: issue 557, the two breakpoint tokens

Approve that the only width at which this refactor changes anything is the band between
640px and 768px, where the form builder's panes now sit side by side instead of stacked.

`before/` is the same spec run against the parent commit. Compare each pair:

| Frame | What it shows |
| --- | --- |
| `form-builder-390` | Stacked, and pixel-identical to `before/` apart from the footer's per-run test email. |
| `form-builder-639` | One pixel below `--bp-compact`: still stacked, same as `before/`. |
| `form-builder-640` | Exactly at `--bp-compact`: panes split. `before/` is still stacked here, because it broke at Tailwind's 768. |
| `form-builder-700` | Inside the moved band. Side by side; `before/` stacked. |
| `form-builder-767` | One pixel below the retired 768. Side by side; `before/` stacked. |
| `form-builder-1280` | Side by side in both, and byte-for-byte identical to `before/`. |
| `responses-table-390` | The compact column drop, unchanged: same size and same content extent as `before/`. |
| `responses-table-1280` | The full six-column table, unchanged from `before/`. |

Every frame is a fresh load at its own width, because resizing a live page races the
builder's `@container` rule (the race reproduces on the parent commit on its own).
