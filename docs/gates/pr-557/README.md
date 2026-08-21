# Gate: issue 557, the two breakpoint tokens

Approve that the builder's three grids now turn at the two boundaries
`plan/admin-design-contracts.md` assigns them, and nowhere else:

- The **steps rail** beside the step editor is rail content (§7), so §1's carve-out
  applies and it turns at `--bp-sidebar` (1024px).
- **Rules beside validation** and **settings beside the rule bench** are page content, so
  §1 sends them to `--bp-compact` (640px).

`before/` is the same spec run against the parent commit, where all three read Tailwind's
`md:` and turned together at 768px. Compare each pair:

| Frame | What it shows |
| --- | --- |
| `form-builder-390` | All three stacked, as in `before/`. |
| `form-builder-639` | One pixel below `--bp-compact`: all three stacked, as in `before/`. |
| `form-builder-640` | Exactly at `--bp-compact`: the two page-content grids split, the steps rail stays stacked. `before/` is stacked throughout, because it broke at 768. |
| `form-builder-700` | Inside the moved band. Page-content grids side by side, steps rail stacked; `before/` all stacked. |
| `form-builder-767` | One pixel below the retired 768. Same shape as 700. |
| `form-builder-1023` | One pixel below `--bp-sidebar`: the steps rail is still stacked. `before/` has it side by side here, because 1023 is above the retired 768. This is the frame that shows the rail's boundary moved. |
| `form-builder-1024` | Exactly at `--bp-sidebar`: the steps rail splits, matching `before/` from here up. |
| `form-builder-1280` | All three side by side, as in `before/`. |
| `responses-table-390` | The compact column drop, unchanged: same size and same content extent as `before/`. |
| `responses-table-1280` | The full six-column table, unchanged from `before/`. |

The reason the steps rail is not on `--bp-compact`: its first track is a fixed 18rem, so
splitting at 640 leaves the step editor 288px, narrower than the 342px it gets stacked on
a 390px phone, and its button labels wrap. §1's clause is "panes stack rather than
shrink", so a split that shrinks the content pane below its phone width satisfies the
words and contradicts the reason.

Every frame is a fresh load at its own width, because resizing a live page races the
builder's `@container` rule (the race reproduces on the parent commit on its own).
