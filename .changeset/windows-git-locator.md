---
"create-qcms-app": patch
---

Find git on a Windows host when `QCMS_GIT_BIN` is unset, so `check:templates` runs on a
native Windows checkout (issue #1126).

`sync-templates.mjs` probed four absolute POSIX locations and nothing else, which is a
deliberate choice - a subprocess launched by bare name is what `sonarjs/no-os-command-from-path`
exists to stop - but it left Windows with no candidate at all, so the gate could only run
with the override set and `pnpm verify` stopped there. The Windows locations are now built
from `ProgramFiles`, `ProgramFiles(x86)` and `LOCALAPPDATA` rather than written out as
literals, because a drive-letter literal in committed text is a machine-specific path that
`check:paths` forbids and would be wrong on a machine that installed elsewhere in any case.
The override and its two rules are unchanged, and the POSIX list is untouched.

The scaffolding templates also gain `apps/admin/components/test-support/git-binary.ts`, the
shared locator the admin's two source-listing checks now use instead of a POSIX-only list
of their own.
