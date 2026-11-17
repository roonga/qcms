Identifiers:
- questionId starts `q_`, stepId `stp_`, optionId `opt_`, ruleId `rul_`,
  formId `frm_`, repeating groupId `grp_`. Use lowercase snake_case after the
  prefix.
- An id is stable forever and is never reused with a different meaning. When the
  meaning of a question changes, propose a new id rather than redefining an old
  one.
- The short name a form or a question carries is the `slug` argument: lowercase
  words joined by hyphens, taken from the title when the person gives none.
