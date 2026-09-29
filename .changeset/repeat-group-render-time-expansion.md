---
"@roonga/qcms-ui": minor
---

The renderer expands a `RepeatGroup` template per live instance (task 073, ADR-42, ADR-43)

A compiled `RepeatGroup` carries its member controls once, so the renderer clones that template per live instance, in roster order, and rewrites each clone's `name` to `ins_7k2/q_passport`. The qualified name is the field's whole identity from there down: `documentForVisible`, the `FieldBlur` wrapper's `id` and `data-qcms-field`, each adapter's `key`, the `__qk__` and `__qa__` markers and the error summary's anchors all keep keying on one opaque string. The roster arrives from the API's step projection through a new `repeat` prop, and a document with no group is rendered exactly as before.

New: `expandRepeatGroups`, `hasRepeatGroup`, the `RepeatGroup` and `RepeatInstance` registry entries and schemas, the `QcmsRepeatContext` behaviour seam, and the `__qop` wire vocabulary on a React-free `@roonga/qcms-ui/repeat-node` subpath so a server-only decoder can read it. `documentForVisible` now leaves a `RepeatGroup` template whole, because a member question's visibility is per instance and the visible set it is handed holds qualified names alone. The stacked presentation is one input per row at every width, with every question type allowed.
