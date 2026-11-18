HANDOFF: AWAITING-HUMAN free space on the C: volume (0.3 GB free; the WSL disk is failing with I/O errors), then run the browser gate and open the PR

# Task 093 handoff

- Implementation, tests, templates, OpenAPI and changeset are committed on this branch.
- Gates run before the disk filled:
  - `pnpm verify`: every stage green except three Docker suites that could not start a Postgres container under host load; those three files re-run green on their own.
  - `pnpm exec turbo run test --force`: 21 tasks, 0 cached, all green; the five changed integration suites repeated three more times, green, slowest test 4.2 s against a 120 s timeout.
- Not run: `QCMS_PORT_SEAT=1 pnpm verify:browser:detached` (admin e2e specs changed: `two-person-rule.pw.ts`, `agent-cards-webhooks.pw.ts`) and `QCMS_PORT_SEAT=1 pnpm up:e2e` (gate E; the security matrix gained probes for the new routes).
- To resume: delete this file, run those two gates on seat 1 in sequence, then open the PR.

## PR body

## Summary

- Task 093: second approval brought in line with `docs/WORKSPACE_ACCESS.md` section 6; criteria 27 to 44, 46, 47, 49, 116.
- Turning the rule on is refused where nobody else could approve (no other active Workspace administrator or Site administrator, or fewer than two active Publish forms holders for `prod`); `GET /workspaces/{id}/settings` returns `nobodyElseCouldApprove` for the warning.
- Turning it off, and a self-grant (join or group edit), are held as workspace approval requests: `GET|POST /workspaces/{id}/approval-requests[/{requestId}/approve|reject]`, re-checked at approval; a self-grant binds the group's sets and never grants a role or environment added later.
- Prod-only site: a draft publish to `prod` with the rule on is held (`202`), bound to the draft revision and a hash over the whole draft row; `GET|POST /forms/{id}/publish-requests[/{requestId}/approve|reject]?environment=prod`. Requester recorded as the freezer, approver as approver.
- Every request state writes a workspace `approval` audit row; held publishes are excluded from the Requests row and the Site configuration list.
- No migration: uses 092's table and `payload`.

## Test plan

- `pnpm verify`
- `pnpm exec turbo run test --force` (Docker-backed suites executed)
- `QCMS_PORT_SEAT=1 pnpm verify:browser:detached` (admin e2e specs now clear the switch directly)
- `QCMS_PORT_SEAT=1 pnpm up:e2e`
