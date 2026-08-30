---
"qcms-admin": patch
---

The rules screen keeps its own test bench, expanded, beside the wizard's (Code Owner, 2026-08-30).

The wizard moved the bench into its third phase, which left the rules screen without one. Both
are wanted, because they answer different questions. The screen's bench sits under the rules
table with a `Select` over the form's rules and is about a rule as it was STORED: "the form has
these rules, what does that one do", which is what an author asks while reading the table. The
wizard's is about the single rule being edited, against the draft the dialog is buffering, so it
is about an edit that has not been saved yet.

They share `RuleTestBench`'s body and its testids, because they are the same panel about
different rules; the two sections are told apart by `qcms-bench` (the wizard's) and
`qcms-bench-screen`. The heading level differs with the frame: an `h2` under the screen's `h1`,
an `h3` under the dialog's own title, which is what keeps `heading-order` true in both.
