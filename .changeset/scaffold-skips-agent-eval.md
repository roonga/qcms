---
"create-qcms-app": patch
---

Keep this repository's agent builder eval out of a scaffolded project. `apps/api/eval/` is
tooling that imports repository scripts the scaffold does not stamp, so it joins `e2e/` in
the excluded app directories.
