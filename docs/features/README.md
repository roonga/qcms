# Active feature work

This directory contains executable work orders only. Completed work orders are removed after their contracts, tests, and documentation land; Git history preserves the original brief.

## Selection order

Use each task's `Depends on` header and the active queue below. Two additional constraints apply:

- 040 must complete before 038.
- 041 never gates 038.

## Execution protocol

1. Read `PROJECT_INSTRUCTIONS.md`, the work order, and its references.
2. Check the active queue, remote claims, open PRs, and `git log`.
3. Stay within deliverables and exit criteria. Ask about genuine decisions.
4. Ship tests and named documentation with the implementation.
5. Run `pnpm verify` and any additional gate required by `CONTRIBUTING.md`.
6. Leave the branch green or commit `HANDOFF.md` with an honest status.
7. Use `feat/NNN-slug`; the pushed branch is the claim.
8. An independent reviewer subagent reviews the exact PR head. Any push invalidates its `AGENT-REVIEW` verdict.

## Active queue

| #   | Work                                     | Stage | Status                                                                                       |
| --- | ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| 030 | Manual portal screen-reader pass         | 7     | awaiting human execution                                                                     |
| 041 | Agent-assisted form building             | 8a    | done (PR #454); controls gated and verified, output quality tunes post-merge behind the flag |
| 049 | Named custom-theme editor                | 9     | Phase 4; does not gate launch                                                                |
| 063 | Public and secure link version targeting | 9     | Phase 4; does not gate launch                                                                |
| 037 | `create-qcms-app` CLI                    | 8b    | done (PR #451)                                                                               |
| 040 | Security review and hardening            | 8b    | in review; provenance verification and Code Owner sign-off remain                            |
| 038 | External launch validation               | 8b    | todo; blocked by 030 and 040                                                                 |
| 061 | Forced password change after bootstrap   | 8b    | todo; does not gate launch                                                                   |
| 039 | Phase-4 backlog publication              | 9     | todo; after 038                                                                              |
| 064 | Environment model and prod migration     | 9     | **drafted for Code Owner review** (issue #995); Phase 4; blocked on open questions Q1 to Q3  |
| 065 | Release records and promotion            | 9     | **drafted for Code Owner review** (issue #995); Phase 4; depends on 064                      |
| 066 | Environment-scoped secure links          | 9     | **drafted for Code Owner review** (issue #995); Phase 4; depends on 064, 065; see 063        |
| 067 | Per-environment delivery and operations  | 9     | **drafted for Code Owner review** (issue #995); Phase 4; depends on 064, 065                 |
| 068 | Workspace model and ownership            | 9     | **drafted for Code Owner review** (issue #995); Phase 4; independent of phase A              |
| 069 | Workspace membership and RBAC            | 9     | **drafted for Code Owner review** (issue #995); Phase 4; depends on 068; blocked on Q12      |
| 070 | Approver-not-author release approval     | 9     | **drafted for Code Owner review** (issue #995); Phase 4; depends on 065, 069                 |

Tasks 049 and 063 are demand-ordered Phase 4 work. Do not dispatch them before launch validation.

**064 to 070 are drafted, not executable.** They are the task breakdown of ADR-40 and ADR-41 (issue #995, Code Owner rulings of 2026-09-25), and `plan/environments-and-workspaces.md` holds their deliverables, exit criteria, dependencies and gates. They have no work-order file in this directory yet, deliberately: this directory holds executable work orders only, and sixteen open questions in section 6 of that plan are the Code Owner's to answer first. The four marked blocking there decide the shape of 064 and 069, so writing a work order before they are answered would be inventing the decision. Phase A is 064 to 067 and phase B is 068 to 070; the two phases land independently, environments first. Do not dispatch any of them before launch validation, and note that 063 and 066 change the same `secure_links` row.

The builder component contract is retained separately as `033-component-contract.md`; it is a current implementation contract, not a work order.
