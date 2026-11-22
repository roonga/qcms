## Summary

- Add `plan/agent-harness-learning-plan.md`: a 12-week plan to hand-build an agent harness in a separate sandbox repo, with QCMS form authoring as the domain.
- Add `plan/agent-harness-tutorial.html`: a companion tutorial with code sketches, interview concepts, a glossary, practice questions and a quiz.
- Docs only. No change to the API, admin, packages or assistant.

Fixes #1410

## Test plan

- [x] `prettier --check plan/agent-harness-learning-plan.md` passes (the HTML is excluded by `.prettierignore`)
- [x] No U+2014 in either new file (searched directly)
- [x] The tutorial's inline script passes `node --check`
- [ ] `pnpm check:no-em-dash` in CI (local run crashed on `git.exe` lookup, not on the content)
- [ ] Reviewer verifies the reference-code claims in the plan's verification notes at the merged head
