---
"create-qcms-app": patch
"@roonga/qcms-ui": patch
---

Add the agent builder's preview and inspect mode, and name each rendered question on its field wrapper.

- The builder preview renders the draft in a device frame whose width is the container the portal's breakpoints read, with device presets, a size readout, rotate, zoom, light and dark polarity, high contrast and Reset answers.
- The draft's own appearance applies to the preview, and the deployment's look where the draft has none.
- Inspect selects a question in the preview; the browser measures each step's layout. Both become strict-schema builder facts.
- `@roonga/qcms-ui` puts `data-qcms-question-id` on the qcms-owned field wrapper, and `questionIdOfField` and `instanceIdOfField` split a field name.
