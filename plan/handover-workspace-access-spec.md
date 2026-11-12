# Handover: workspace access spec

Status: 2026-11-13. Branch `docs/workspace-access-spec`, pushed, head `bf91760a`, level with `origin/main`, no PR (Code Owner: not required). Docs only; nothing is built in code. Paths below are on that branch.

## Where things are

| What                                         | Where                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative model (single source of truth) | `docs/WORKSPACE_ACCESS.md` (sections 1-16; criteria 1-116 in section 14)                                                           |
| User-guide explainer                         | `docs/workspace-access-guide.html` (also published as an Artifact, version 4)                                                      |
| Implementation plan                          | `plan/workspace-access-implementation.md` (proposed tasks 084-105, quick fix Q1)                                                   |
| ADR and security records                     | `docs/adr/core.md`, `docs/SECURITY_DESIGN.md` (link to the spec; as-built wording kept, unbuilt model marked "decided, not built") |
| Design canvas (UI plan)                      | https://claude.ai/artifact/S1Mt2WFT52Q9vKuqNPARD4 (about v51, 20 new boards, never rendered or verified)                           |
| Design system                                | https://claude.ai/artifact/Cf4ksVkigAQiy5ohmHXaa6 (vocabulary only)                                                                |
| Retained review record                       | `plan/workspaces-review.md` (holds R7, R15, R19)                                                                                   |

## Model in one paragraph

Workspace is the only access zone; no per-form authorisation. One kind of access group = a set of roles (View forms, Edit forms, Publish forms, View responses, Erase responses) plus one environment set. Site administrator and Workspace administrator. Starter groups Authors, Publishers, Response viewers, Response erasers (renamable, deletable). One user-facing Publish step over frozen versions; prod needs a prior non-prod publish. Second approval is prod-only and a held publish applies the draft as requested (refused if the draft changed). Accounts are created by emailed single-use link (72 h; requests 7 days), disabled never deleted, with a site-level audit log. Screen label is "Members".

## Review state

- Four review rounds; verdict `AGENT-REVIEW: APPROVE @c09c9799`. The later merge of main (`bf91760a`) only added CI and config files; gates were not re-run after it.
- All Majors closed by Code Owner rulings G1-G24.
- Open nit, non-blocking: no audit kind for an approval refused because the draft changed; decide in the foundation task.

## Not done

- Design canvas boards never rendered; possible clipping on the New workspace board and tall phone screens; no confirmed board for the Create form flow.
- Code Owner must review the canvas before any admin UI task starts.
- Mail dependency choice for the email task.
- Reserve task numbers 084-105 in the ledger.
- Questions-at-archive rule is undecided.
- Design system access-group card could be redrawn; `docs/*.html` could be exempted from prettier.
- The guide still loads Google Fonts (left on purpose).
- Design sync handover (Claude Design, Sonnet) was issued; its result is unverified.

## Overlap to watch

- `plan/handover-agent-builder-and-workspaces.md` section 2 predates this spec: its open rulings, "installation administrator", "No Move screen" and multi-select-roles wording must be reconciled with `docs/WORKSPACE_ACCESS.md`.
- Agent builder first-step form creation and tools-follow-grants must follow the new roles.

## Resuming

1. `git fetch`; merge `origin/main` if behind (no force push); rerun `pnpm check:all` and `prettier --check` on changed files.
2. Open one PR for the spec when the Code Owner asks; body `## Summary` and `## Test plan`.
3. Task 084 onward per the implementation plan, gated on the canvas review for any admin UI.
