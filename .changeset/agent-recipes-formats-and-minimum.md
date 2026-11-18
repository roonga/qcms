---
"create-qcms-app": patch
---

Scaffold the assistant recipes that take the published formats and the long text minimum.

The long free text recipe sets `constraints.minLength` instead of saying a minimum cannot
be set, and the email, phone and postcode recipes quote the `FORMAT_PATTERNS` entries from
`@roonga/qcms-core` verbatim, with the UK and New Zealand postcodes added. The system
prompt names both lengths for `shortText` and `longText`, and `SYSTEM_PROMPT_VERSION`
moves to 29 with the text.
