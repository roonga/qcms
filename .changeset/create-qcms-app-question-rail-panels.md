---
"create-qcms-app": minor
---

Scaffold the question detail screen's panelled editor (Code Owner, 2026-09-27).

The generated admin follows `apps/admin`: the rail nests panel rows under the selected
version, the column shows the preview plus the one panel `?panel=` names, a refused save
opens the panel carrying the issue and moves focus into it, and the question's details, the
back link and a sticky Save land where `.changeset/admin-question-rail-panels.md` describes
at length. Two new modules come with it, `lib/questions/panels.ts` and
`lib/questions/editor-bridge.ts`, the preview becomes the last panel rather than a card above
the editor, the rail takes the form builder's own styling, and three catalog keys go:
`questions.editor.typeLocked`, `questions.editor.noConstraints` and `questions.message.none`.
