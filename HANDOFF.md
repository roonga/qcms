HANDOFF: AWAITING-HUMAN repair the WSL Ubuntu filesystem (binaries and /tmp return I/O errors), then rerun the full browser gate at this head

- Round-1 fixes and the accept-token ruling are implemented and pushed.
- Green: `pnpm verify` (WSL) at `f62655a2`; forced Docker tests at `948208cd`; `agent-cards-apply-draft.pw.ts --repeat-each=5` 20 of 20.
- Open: the full `verify:browser` run at `3b972d3c` stopped when WSL failed. Before that it showed two admin failures to recheck: `agent-cards-workspace.pw.ts:172` (audit page grouping across a shared 50-row page) and `forced-password-change.pw.ts:83`. An earlier full run also showed `ops-focus.pw.ts:111` once.
- Remove this file once the gate is green.
