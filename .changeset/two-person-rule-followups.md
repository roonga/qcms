---
"@roonga/qcms-db": patch
"create-qcms-app": patch
---

Task 070 follow-ups from PR #1100's round-two review. **No behaviour changes**: three comments
that named the wrong mechanism, one browser-spec cleanup hook, and one test for a branch that
had none.

What a reader of the source gains. The withdraw handler's docblock said an applied proposal is
refused because `requireProposal` treats it as absent; it does not, and it returns one on
purpose, so the docblock now names the explicit guard that does refuse it and says what stands
behind that guard rather than listing three plausible mechanisms. The new `GRANT_SOURCES` entry
for `control.webhook_endpoint_proposals` said its position in the registry was a dependency; for
that entry it is chronology, and the comment says so, because a reader looking for the test that
enforces the order would not find one. And `submitSignIn`'s hydration wait is recorded as the
redundant, explicit poll it is rather than as the cause of the flake it was added while chasing:
`fillStable` already waited inside its retry loop.

What a maintainer of the suites gains. `apps/admin/e2e/two-person-rule.pw.ts` turns the workspace
switch off in an `afterAll` as well as in its last test, so a failure that cuts the serial group
short cannot leave the switch on for a CI retry, where test 2 asserts it is off and would
otherwise report a flake elsewhere as a broken default. And the confirm route's
applied-and-proposer branch has a case: the rule does not stop applying once the change has
landed, and deleting the refusal now turns a test red.
