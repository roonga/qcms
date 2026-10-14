---
"@roonga/qcms-db": major
---

Make the closed state per (form, environment) and take `forms.status` away (task 066,
ADR-40 with ADR-39's Amendment, Q18).

A form was open or closed installation-wide, so closing production intake also stopped a
test run and the reverse. The per-environment **release state** now carries the value:
`control.form_releases` gains a `closed` flag, and the newest row for a
(form, environment) pair answers both "which version is released here" and "is intake
open here". One read serves the respondent path, which is why the value sits on that
state rather than in a table beside it - an environment role already holds `SELECT`
there (Q48's read list), so no grant widens and ADR-40's role table is unchanged.

Closing and reopening **append**, carrying the released version forward with the flag
flipped, so they inherit this table's properties rather than needing their own: the
history records who closed `prod` and when, nothing can rewrite it, and a close is never
observed as a version change. A release does not reopen a closed environment - it carries
the current value forward, because closing is a deliberate operational act and releasing
a version is not a request to resume intake.

Breaking, in three places:

- `control.forms.status` and the `control.form_status` enum are **dropped**. A column
  there could only say "closed everywhere". Anything reading `forms.status` reads the
  release state instead.
- `closeForm` and `reopenForm` are replaced by `closeFormInEnvironment` and
  `reopenFormInEnvironment`, which take the environment and return the appended release
  row, or `undefined` when the form has nothing released there - there is no state to
  close, and a start there already refuses with `NO_PUBLISHED_VERSION`.
- `FormRow` loses `status`. `FormStatus` stays as the derived union a screen renders, and
  `getFormEnvironmentState` and `environmentStatesByForm` are where it is derived - the
  second reading one environment's newest row per form in one query, for the admin's form
  library.

`FormReleaseRow` gains `closed`, and `insertFormRelease` takes it.
