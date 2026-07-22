---
"@qcms/ui": minor
---

Give each rendered control a stable, questionId-keyed focus target (task 030).
The qcms-owned `FieldBlur` wrapper in the registry adapters now carries
`id={name}` and `data-qcms-field={name}` (it stays a `display:contents` wrapper,
so it adds no box and no accessibility-tree node - the conformance a11y outline
is unchanged). This is the hook the flow-level accessibility work needs: a host
app can target a specific question for focus (error-summary "jump to field"
links, and focus recovery when a branch change removes the focused question)
without reverse-engineering each control type's internal DOM. The honeypot node
is unaffected and stays invisible to assistive tech.
