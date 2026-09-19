---
"@roonga/qcms-ui": minor
---

Render a native day input for a date question in native-submit mode, so a required date
is answerable and submittable with scripting disabled (issue #920).

The controlled render is unchanged. In native-submit mode the DatePicker adapter used to
render the same vendored control uncontrolled, which does not work on that path for two
reasons: react-aria's DatePicker is a row of JS-driven `role="spinbutton"` segments a
respondent with no scripting cannot type into, and its form value rode on an
`<input type="text" hidden required>`. That mirror is `hidden` rather than
`type="hidden"`, so `willValidate` stays true and the browser tries to report its
validity; being unfocusable it cannot, and Chrome abandons the whole form's submission
(`An invalid form control with name='q_dob' is not focusable`). A step holding a required
date was a dead end without JavaScript.

Native-submit mode now renders `NativeDateField`, qcms-owned markup around a real
`<input type="date">` carrying the question's label, description, error slot and ISO
`min`/`max` bounds. It posts `YYYY-MM-DD` under the same field name with the same
`string` kind tag, so nothing downstream of the renderer changes, and a browser without
`type="date"` degrades to a text box whose string the API still validates. Every vendored
file stays byte-identical to upstream (ADR-22), and `input[type="date"]` joins the
tabular-figures selector in `theme-components.css`.
