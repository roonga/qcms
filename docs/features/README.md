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

| #   | Work                                     | Stage | Status                                                            |
| --- | ---------------------------------------- | ----- | ----------------------------------------------------------------- |
| 030 | Manual portal screen-reader pass         | 7     | awaiting human execution                                          |
| 041 | Agent-assisted form building             | 8a    | todo; does not gate launch                                        |
| 049 | Named custom-theme editor                | 9     | Phase 4; does not gate launch                                     |
| 063 | Public and secure link version targeting | 9     | Phase 4; does not gate launch                                     |
| 037 | `create-qcms-app` CLI                    | 8b    | todo; optional for launch                                         |
| 040 | Security review and hardening            | 8b    | in review; provenance verification and Code Owner sign-off remain |
| 038 | External launch validation               | 8b    | todo; blocked by 030 and 040                                      |
| 061 | Forced password change after bootstrap   | 8b    | todo; does not gate launch                                        |
| 039 | Phase-4 backlog publication              | 9     | todo; after 038                                                   |

Tasks 049 and 063 are demand-ordered Phase 4 work. Do not dispatch them before launch validation.

The builder component contract is retained separately as `033-component-contract.md`; it is a current implementation contract, not a work order.
