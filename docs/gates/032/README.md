# Gate evidence - task 032 (admin question library)

**Unsigned.** This is round three of the 032 design gate, and the set is a full recapture.

Round one had no screenshot set at all: the capture spec was backed out rather than
shipped failing (issue #220), and the topbar in it was still 055's composition, which the
Code Owner had since superseded.

Round two's 18 frames were signed on 2026-08-01 and that signature **does not carry
forward**, because the live review that produced it also found three defects in the very
geometry the frames depicted. Those are fixed, so the old set now shows a rendering that
no longer exists and every frame here has been recaptured on the fixed one:

- the account monogram is a **circle**; it was an oval, because a `min-block-size` control
  floor of 40px beat the declared 32px height on both trailing controls;
- the appearance glyph draws at **28px**, not 24px: a 1.75-weight outline at 24 read as
  visibly lighter than the filled 32px disc beside it, so the card's claim of optical
  parity was not what the eye saw;
- hover and focus on both triggers draw a **circular** ring rather than a rounded square,
  so the two controls read as a pair.

The design card `plan/admin-theme/ds-navbar.html` is being reconciled to these values by
the design seat, which adopts the implementation as ground truth: these were the Code
Owner's own live calls.

Approve two things at once, because they land together:

1. **The question library's three screens** - the list, a question's detail (version
   timeline plus the rendered preview), and the editor with its option list.
2. **The rebuilt topbar trailing group**, which is in every frame because it is chrome:
   a 32px icon-only appearance trigger and a 32px circular account monogram, each opening
   a menu. This is what the frozen design card `plan/admin-theme/ds-navbar.html` specifies
   (sections "Appearance mode control" and "Account menu"), and it replaces both the
   three-chip mode control 055 shipped and this bar's standalone Sign out button.

Three screens at 390px (`-390.png`) and 1280px (`-1280.png`) in all three modes
(`-light-`, `-dark-`, `-hc-`): 18 frames, from the real screens through the e2e harness,
authored the way an operator would author them. The mode is set the way an operator's
browser sets it, through the `qcms-app-mode` cookie the root layout reads.

| File | What to approve |
| --- | --- |
| `library-list-<mode>` | The governed library: the monospace question ID column, the type column and type filter (issue #218), status tags, the search and filter toolbar, and how a wide table behaves inside a 390px window. |
| `question-detail-<mode>` | The version timeline (v2 draft over v1 published, each with its status tag and publication date), the preview rendered by the same engine that serves a respondent, and the editable draft below it. |
| `question-editor-<mode>` | The creation form: the derived `q_` ID callout and its immutability copy, the locked-after-creation type picker, and the option list editor with its minted-once `opt_` ids. |
| The topbar, in all 18 | Closed state only (a menu cannot be held open across a full-page capture). At 1280 the trailing group sits at the right of a single row; at 390 the nav wraps beneath the wordmark and the two controls stay on the top row, which is the card's own narrow-viewport behaviour. In high contrast the appearance trigger keeps a permanent 1px border, deliberately: a borderless icon is exactly what an operator in that mode cannot find. |

What is **not** in these frames, and where to find it instead:

- **The open menus.** A full-page screenshot cannot hold a popover open, so the menus are
  proved rather than shown: `apps/admin/e2e/a11y-axe.pw.ts` sweeps each one open in all
  three modes with zero axe violations, including a pass with the check moved to a
  different row, and `appearance.pw.ts` asserts that the checked row is distinguishable by
  a check glyph, weight and an inset accent edge rather than by colour. The card's own
  drawings of the open state are the visual reference.
- **The auth screens and Settings.** Unchanged by this task; `docs/gates/055/` holds them,
  with the caveat that its topbar is the pre-032 composition.
- **Sign-out without JavaScript.** Kept, per the Code Owner's 2026-07-31 decision: with
  scripts off, both triggers hide and a plain POST form appears in their place. Proved in
  `auth-2fa.pw.ts` rather than shot, since the frames here are all scripted.
- **The preview's interactivity.** The detail frames show the preview at rest, which is
  how it renders before anyone touches it. That it now ACCEPTS input - a checkbox can be
  ticked, and nothing is sent anywhere when it is - was the Code Owner's other live
  finding, and it is proved in `questions-lifecycle.pw.ts` rather than shown, because a
  static frame cannot depict the difference between a live control and a frozen one. That
  is exactly why the defect survived round two's set.

Two notes on the data, so the frames are read for what they are: the library holds the
insurance seed plus a few questions this capture authors (the `q_gate_*` rows), and the
list has **no "Updated" column** - nothing in the schema records when a draft was last
edited, so `docs/wireframes/admin-question-library.md` now carries an accepted-deviation
note rather than promising it (issue #218).

Regenerate this set with:

```
QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-032
```
