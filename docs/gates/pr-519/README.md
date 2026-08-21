# Gate: collapsible digests and summary headings (issue 519)

Approve design-language element 3 in the three places `plan/admin-ux-audit.md` approves it
and nowhere else. Every collapsible is shot **shut and open**: the digest is only visible
while the disclosure is shut, and §3.7's rule (a fact in the digest must also exist inside
the panel, because a collapsed `<details>` is gone from the accessibility tree) is only
visible while it is open. One frame of either state proves half a claim.

**30 files, 30 distinct page states** (5 states x 3 mode layers x 2 widths), at **390px and
1280px** (`-390.png` / `-1280.png`). Captured by `apps/admin/e2e/gate-519.pw.ts`, which runs
only with `QCMS_ADMIN_CAPTURE_GATE=1`.

Five states rather than six, because these are full-page shots of a screen carrying two
independent disclosures, so a frame is a state of the **page** and not of one panel. Both
builder panels shut is one frame carrying both digests, not two frames of the same picture.

| Frame | The clause it carries |
|---|---|
| `builder-panels-collapsed-light` | §4.3: an `h2` inside each `<summary>`, so both panels finally have an entry in the builder's heading outline at the level every other section uses. Both digests are here side by side: `Form settings - Challenge required, minimum time 800 ms` and `Rule test bench - rul_..., reads 1 question`. |
| `builder-settings-expanded-light` | §3.7 for the settings digest: the checkbox and the number field the digest read those same two facts from, underneath it. |
| `builder-bench-expanded-light` | §3.7 for the bench digest: the fieldset holds exactly as many answer controls as the digest said questions read. The audit's blessed shape, "the count in the summary plus the entries inside". Settings is shut here, so the frame isolates the bench. |
| `delivery-row-collapsed-light` | §3.8: the row trigger states status, failed attempts and latency. **Read this one at 1280** (see the limitation below). |
| `delivery-row-expanded-light` | The `This delivery` list states all three in full, which is what stops the digest being the only copy of latency at 390px, where the latency column is `display: none`. That list's `h3` also closes issue #541's `<h4>`-under-`<h2>` skip. |
| the `-dark` and `-hc` sets | The same five states in the other two mode layers. The digest is new painted text on `--color-text-muted` against a summary and a link-styled button, and high contrast is where a muted secondary line is most at risk. |

**One honest limitation, in the screen rather than in the capture.**
`delivery-row-collapsed-*-390.png` does not show the trigger: at that width the last columns
of the deliveries table sit inside the table's own horizontal overflow, and the shared
capture helper deliberately resets every container's `scrollLeft` before shooting (a frame
painted at a scroll offset is the worse failure, and has shipped before). So read the digest
itself from the 1280 collapsed frame. The 390 pair still carries the claim that matters most
at that width: latency's column is dropped there, and the expanded panel states it anyway.

## One treatment detail worth a deliberate yes or no

On the delivery row the digest sits **inside** the trigger button, so it forms part of the
control's accessible name rather than floating beside it as an unassociated caption. The
consequence is visual: that button is styled as a text link, so the digest line inherits the
link underline and reads as a second underlined line under the action. It is legible and
clearly subordinate (smaller, muted), and no card in `plan/admin-theme/` governs it. Accept
it or send it back for an underline opt-out; the placement inside the button should stay
either way, because that is what makes the digest part of what the trigger is called.

## What is deliberately absent

Any fourth digest anywhere in the app. §5.2 keeps one-time reveals non-collapsible, and the audit's "would not
do at all" list rejects element 3 everywhere else for now, so the absence is part of what is
being approved.

No digest states an **issue** count. `plan/admin-ux-audit.md` §5.6 gives the builder exactly
one authoritative issue count, in the validation panel, and a second count of an overlapping
set is the POC mistake the audit names. No digest makes a **save** claim either, for
`plan/admin-design-contracts.md` §6's reason: the builder states its save model once, in the
ambient strip.

## Red-first proof

`red-vitest.log` and `red-playwright.log` in this directory are the failing runs of the new
tests against the pre-change components, kept beside the frames so the evidence and the
claim live together.
