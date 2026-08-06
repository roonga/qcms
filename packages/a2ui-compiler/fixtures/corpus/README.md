# Corpus-local fixtures (task 048)

Form and question fixtures that exist only to drive **appended** golden-corpus
entries, kept here rather than in `packages/core/fixtures/` for two reasons:

- the kernel's `fixtures/questions/valid/` is asserted to cover each question
  type **exactly once** (`question-definition.test.ts`), and its
  `fixtures/forms/valid/` is asserted to pin only questions from that set
  (`form-definition.test.ts`) - both would fail if a corpus form's own questions
  were added there;
- ADR-18 makes the corpus append-only, so a corpus entry's inputs must be
  addable without touching anything an existing golden was compiled from.

Content stays in the neutral vehicle domain (043) and carries no health or
otherwise sensitive terms.

The runner (`src/golden-corpus.test.ts`) reads questions from **both** roots and
each form from the root its corpus row names.
