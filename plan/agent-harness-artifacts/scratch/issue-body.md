## Summary

- Add `plan/agent-harness-learning-plan.md`: a 12-week, hand-built agent harness plan for a separate sandbox repo, using QCMS form authoring as the domain.
- Add `plan/agent-harness-tutorial.html`: a companion tutorial with code sketches, interview concepts, a glossary, practice questions and a quiz.
- The sandbox writes its own SSE parser and tool loop against the raw provider API, then compares each part with `apps/api/src/features/agent` and logs the divergences.
- Docs only. No change to the API, the admin, the packages or the assistant.

## Scope

- Phases P0 to P12: stream layer, loop, application layer, proposals, signed confirmation, permissions, draft safety, context, evals.
- Evaluation split into deterministic tests, provider contract tests and live evals with paired comparison.
- Cut-lines, a minimum viable path, a cost cap and interview-claim guidance.

## Exit criteria

- [ ] The plan and tutorial are reviewed and merged.
- [ ] Every claim about the reference code is verified at the merged head, or marked unverified.
