# Gate: collapsible digests and summary headings (issue 519)

Approve design-language element 3 in the three places `plan/admin-ux-audit.md` approves it
and nowhere else. Every collapsible is shot **twice**: the digest is only visible while the
disclosure is shut, and §3.7's rule (a fact in the digest must also exist inside the panel,
because a collapsed `<details>` is gone from the accessibility tree) is only visible while
it is open. Each pair is one claim.

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`), in all three mode
layers. Captured by `apps/admin/e2e/gate-519.pw.ts`, which runs only with
`QCMS_ADMIN_CAPTURE_GATE=1`.

**Two things about the set that are worth knowing before you read it**, so neither looks
like an error:

- **36 files, 30 unique images.** `builder-settings-expanded-<mode>-<width>.png` and
  `builder-bench-collapsed-<mode>-<width>.png` are byte-identical, in all six mode and
  width combinations. Both names are honest: these are full-page shots, and one page state
  (settings open, bench shut) genuinely carries both claims at once. They are kept under
  both names so each row of the table below resolves to a frame.
- **The collapsed delivery row is not legible at 390px.** At that width the trigger column
  sits inside the table's horizontal overflow, so `delivery-row-collapsed-*-390.png` shows
  the queue without the trigger in view. The §3.7 claim at 390 is carried entirely by the
  **expanded** frame, which is where it matters: the latency column is dropped and the
  panel's `This delivery` list still states it. Read the 1280 collapsed frame for the
  digest itself.

| Frame pair | The clause it carries |
|---|---|
| `builder-settings-collapsed-light` / `builder-settings-expanded-light` | §4.3: an `h2` inside the `<summary>`, so the panel finally has an entry in the builder's heading outline at the level every other section uses. §3.7: the digest states the challenge switch and the minimum-time value, and the expanded frame shows the checkbox and the number field that hold those same two facts. |
| `builder-bench-collapsed-light` / `builder-bench-expanded-light` | The same `h2`, and a digest naming the loaded rule and how many questions it reads. Expanded, the fieldset holds exactly that many answer controls: the audit's blessed shape, "the count in the summary plus the entries inside". |
| `delivery-row-collapsed-light` / `delivery-row-expanded-light` | §3.8: the row trigger states status, failed attempts and latency. Expanded, the `This delivery` list states all three in full, which is what stops the digest being the only copy of latency at 390px, where the latency column is `display: none`. That list's `h3` also closes issue #541's `<h4>`-under-`<h2>` skip. |
| the `-dark` and `-hc` sets | The same six states in the other two mode layers. The digest is new painted text on `--color-text-muted` against a summary and a link-styled button, and high contrast is where a muted secondary line is most at risk. |

## One treatment detail worth a deliberate yes or no

On the delivery row the digest sits **inside** the trigger button, so it forms part of the
control's accessible name rather than floating beside it as an unassociated caption. The
consequence is visual: that button is styled as a text link, so the digest line inherits the
link underline and reads as a second underlined line under the action. It is legible and
clearly subordinate (smaller, muted), and no card in `plan/admin-theme/` governs it. Accept
it or send it back for an underline opt-out; the placement inside the button should stay
either way, because that is what makes the digest part of what the trigger is called.

## What is deliberately absent

Any fourth digest. §5.2 keeps one-time reveals non-collapsible, and the audit's "would not
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
