# Gate: collapsible digests and summary headings (issue 519)

Approve design-language element 3 in the three places `plan/admin-ux-audit.md` approves it
and nowhere else. Every collapsible is shot **twice**: the digest is only visible while the
disclosure is shut, and §3.7's rule (a fact in the digest must also exist inside the panel,
because a collapsed `<details>` is gone from the accessibility tree) is only visible while
it is open. Each pair is one claim.

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`), in all three mode
layers. Captured by `apps/admin/e2e/gate-519.pw.ts`, which runs only with
`QCMS_ADMIN_CAPTURE_GATE=1`.

| Frame pair | The clause it carries |
|---|---|
| `builder-settings-collapsed-light` / `builder-settings-expanded-light` | §4.3: an `h2` inside the `<summary>`, so the panel finally has an entry in the builder's heading outline at the level every other section uses. §3.7: the digest states the challenge switch and the minimum-time value, and the expanded frame shows the checkbox and the number field that hold those same two facts. |
| `builder-bench-collapsed-light` / `builder-bench-expanded-light` | The same `h2`, and a digest naming the loaded rule and how many questions it reads. Expanded, the fieldset holds exactly that many answer controls: the audit's blessed shape, "the count in the summary plus the entries inside". |
| `delivery-row-collapsed-light` / `delivery-row-expanded-light` | §3.8: the row trigger states status, failed attempts and latency. Expanded, the `This delivery` list states all three in full, which is what stops the digest being the only copy of latency at 390px, where the latency column is `display: none`. That list's `h3` also closes issue #541's `<h4>`-under-`<h2>` skip. |
| the `-dark` and `-hc` sets | The same six states in the other two mode layers. The digest is new painted text on `--color-text-muted` against a summary and a link-styled button, and high contrast is where a muted secondary line is most at risk. |

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
