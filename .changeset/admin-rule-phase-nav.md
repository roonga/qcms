---
"qcms-admin": patch
---

The rule wizard gets Back and Next, and drops its save sentence (Code Owner, 2026-08-30).

Back and Next sit in their own group at the end of the footer, because they are not commands
about the rule: §5 orders the rule's own actions, and a Next between Save and Cancel would read
as a third thing to do to the rule rather than as a way of moving inside the dialog. They do not
gate, which is what lets them sit beside a tablist rather than replace it - `phase` is one piece
of state with two ways to set it, and neither withholds a phase from the other. They are
disabled at the ends rather than hidden, so the row does not reflow under the pointer, and their
accessible names say which phase the press goes to.

The footer's "This rule is saved when you press Save.", its `?` and the text behind it are gone:
the Code Owner ruled the model obvious from the two buttons. `plan/admin-design-contracts.md` §6
records that its 2026-08-21 amendment is a licence rather than an obligation, and that what made
the sentence redundant here was the explicit Cancel rather than the fact of being a dialog.
