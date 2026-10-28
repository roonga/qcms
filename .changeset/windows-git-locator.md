---
"create-qcms-app": patch
---

Find git on a Windows host when `QCMS_GIT_BIN` is unset, so `check:templates` runs on a
native Windows checkout.

- `sync-templates.mjs` probed four absolute POSIX locations only, so Windows had no
  candidate and the gate needed the override set.
- The Windows locations are built from `ProgramFiles`, `ProgramFiles(x86)` and
  `LOCALAPPDATA`, not written as literals: a drive-letter literal in committed text is a
  machine-specific path.
- The override, its two rules, and the POSIX list are unchanged.
- The scaffolding templates gain `apps/admin/components/test-support/git-binary.ts`, the
  shared locator the admin's two source-listing checks use.
