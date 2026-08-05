# Gate evidence - task 048 (author-supplied validation messages and boolean label overrides)

Approve the task 048 question-editor fields: a short-text question's four message boxes
sitting empty with the sentence a respondent would see today showing as each one's
placeholder, this question's own bounds interpolated into it
(`messages-placeholders`), the same screen with an author's own wording typed into every
box so the two frames read as inherited against overridden (`messages-authored`), and a
yes/no question's two label fields on their "Yes" and "No" lexicon defaults
(`boolean-labels`) - each at 390px and 1280px in light, dark and high contrast.

What to look for, and what is proved elsewhere rather than shown:

- **A placeholder must read as a default, not as content.** That is the one judgement a
  static frame can carry and a test cannot, and it is why the narrow frames matter most: a
  placeholder is a full sentence inside a text input, and a default an author cannot read
  at 390px is a default they will overwrite for no reason.
- **A field appears only for a constraint the question carries.** Unticking "an answer is
  required" or clearing "Shortest answer" removes its message box, which is what makes the
  kernel's `ORPHAN_MESSAGE_KEY` unreachable from this screen. Not shown (a frame cannot
  depict an absence): proved in `apps/admin/lib/questions/definition.test.ts` and walked in
  `apps/admin/e2e/questions-lifecycle.pw.ts`.
- **A blank box stores nothing.** Saving an untouched field leaves the key absent, so a
  later improvement to the shipped wording still reaches the question. Same two places.
- **Each boolean label falls back on its own.** The frame shows both on their defaults;
  the mixed pair (one overridden, one on the lexicon) and the unchanged `true`/`false` wire
  values are proved in the lifecycle walk and in the compiler's appended corpus entry.
- **Contrast in all three modes** is swept automatically as well, in
  `apps/admin/e2e/a11y-axe.pw.ts` ("the message and boolean-label fields have zero
  violations").

Regenerate this set with:

```
QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-048
```
