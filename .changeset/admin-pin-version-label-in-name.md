---
"create-qcms-app": patch
---

Name the step editor's pin version control with the version it shows (issue #879).

The control painted `v3` and answered to "Move pin for q_at_fault_accident", so its
visible text appeared nowhere in its accessible name: the WCAG 2.5.3 label-in-name
failure. A speech-input operator saying "click v3" moved nothing, and a screen-reader
operator heard a name no sighted colleague could point at. The name is now
`v3, move pin for q_at_fault_accident` - the visible text first, from the same catalog
message the control paints, then the pin it moves, which is why it carries a label at all.
