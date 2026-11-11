# Workspace access: scenario test cases and results

Run: 2026-11-10T21:04:20.293Z. Code snapshot: `39aedc33`. Runner: `node plan/workspace-access-scenarios.mjs`.
Runner SHA-256: `8cae3d69a48556b73ed1acc64054372147a2053ba6783c5370ef01477ab2e4ca`. Runtime: v24.21.0 on linux.

## What was tested

standalone plan/scenario model; not application, API, database, UX usability or throughput testing.

**4467/4467 assertions passed** across **369 configurations** and **39 targeted cases**. 317 configurations were ready for all declared collecting responsibilities; 52 were correctly blocked by missing independent-publisher coverage. A passing refusal assertion is not a successful business workflow.

## Results by account count

| Total accounts | Configurations | Ready | Correctly blocked |
| -------------- | -------------- | ----- | ----------------- |
| 1              | 75             | 33    | 42                |
| 2              | 72             | 62    | 10                |
| 10             | 72             | 72    | 0                 |
| 100            | 75             | 75    | 0                 |
| 1000           | 75             | 75    | 0                 |

## Test dimensions

| Dimension          | Values                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| users              | [1,2,10,100,1000]                                                                   |
| environments       | [["test"],["prod"],["dev","test","prod"]]                                           |
| workspaces         | [1,3]                                                                               |
| formsPerWorkspace  | [1,10]                                                                              |
| arrangements       | ["shared","departmental"]                                                           |
| approvalPolicies   | ["off","prod-only","all-environments"]                                              |
| extraGroupFixtures | 1,000 form access groups for 1, 100 and 1,000 accounts, each with 3 policy variants |

## Assumptions and limits

- Baseline groups cover every fixture form and role environments use the same environment set. T21-T26 separately test disjoint/overlapping form scopes and non-empty independent role environment scopes; these are not factorial scope dimensions.
- Initial form access is group-only. The fixtures and creation transition reference existing groups, not direct user ACLs. Creating/updating memberships remains separate administrative work.
- Accepted checkpoints: an eligible editor for drafts; publishing/response/erase coverage before collection; retained-data and still-enabled operations remain covered after closure.
- Approval off, prod-only and all-environments are sensitivity variants, not three accepted configuration options.
- Baseline collection readiness includes a specific publish request from an eligible publisher in each destination. That request needs a different eligible approver where policy applies. Drafts do not have a permanent two-publisher requirement (T33-T34). T15 is only an authorship-difference probe, not a complete approval request.
- Shared means all fixture accounts explicitly hold all form roles; departmental means account rosters split by workspace and roles split within each roster. Empty workspace rosters reuse an existing account to preserve a one-person multi-workspace case.
- Ineligible includes disabled or unusable provisional accounts. Logged-in presence is not required.
- Ordinary removal preserves coverage. Accepted emergency suspension immediately blocks the account/sessions across all memberships, records affected duties, and may include the last administrator; authorised operator recovery is required. Tests model this without proving real token/session enforcement.
- No actual forms are created and no actual approvals, erasures or exports execute. Database transaction/concurrency safety and production performance remain untested.
- Administrator continuity is checked in targeted final-state fixtures, not across the baseline matrix. Exact creation allocation, initial recipient storage, approval request state transitions, actual archive transitions and real credential recovery are not implemented or end-to-end tested.

## Important outcomes

- One eligible person can cover every declared task with explicit self-assignment and approval off, across one or three environments and workspaces.
- One eligible person cannot provide an independent second approval. A test-only environment works under the prod-only sensitivity policy; all-environment approval blocks it.
- Headcount alone is insufficient. A departmental workspace with one eligible publisher is blocked even if another department has more people.
- Draft editing can remain available while collecting-environment coverage is blocked under the proposed lifecycle rule.
- Empty, pending and disabled assignments do not count; new forms/environments and response scopes do not silently grant other access.
- Ordinary removals preserve coverage; accepted emergency suspension bypasses that guard with audit/remediation and no silent replacement. T04 records the strict-policy counterexample; T27-T30 exercise the accepted exception.
- Approval readiness belongs to the exact requested action, not a standing number of publishers on every draft (T33-T34).

## Twelve checks for every configuration

1. **Creation membership grants creation only**. Expected: [true,false,false,false]. Actual: [true,false,false,false]. PASS.
2. **Draft responsibilities covered**. Expected: READY. Actual: READY. PASS. Draft-editor checkpoint is a proposed lifecycle rule.
3. **Collecting and independent-approval readiness**. Expected: READY. Actual: READY. PASS. Explicit permissions cover each declared environment and responsibility.
4. **No access to unassigned form**. Expected: false. Actual: false. PASS.
5. **No creation in unassigned workspace**. Expected: false. Actual: false. PASS.
6. **No access to newly added environment**. Expected: false. Actual: false. PASS.
7. **Response environment cannot authorise publishing**. Expected: [true,false]. Actual: [true,false]. PASS.
8. **Empty editor group is not coverage**. Expected: true. Actual: true. PASS.
9. **Pending editor grant is not coverage**. Expected: true. Actual: true. PASS.
10. **Disabled sole editor is not coverage**. Expected: true. Actual: true. PASS.
11. **Removing creation membership preserves separate editing**. Expected: [false,true]. Actual: [false,true]. PASS.
12. **Different-person editor handover requires an eligible replacement**. Expected: BLOCKED. Actual: BLOCKED. PASS. This checks an ordinary different-person handover; not an emergency-suspension policy.

## Targeted lifecycle and refusal cases

| ID  | Case                                                                                        | Expected                           | Actual                             | Result | Interpretation                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | Two stale removal checks can jointly orphan a form                                          | [0,0,1]                            | [0,0,1]                            | PASS   | Counterexample: real implementation must serialise final-state checks.                                                                                          |
| T02 | Serialised final-state validation refuses the second removal                                | REFUSED                            | REFUSED                            | PASS   | Model refusal, not a database lock test.                                                                                                                        |
| T03 | A saved draft with pending-only access has no editor                                        | UNCOVERED                          | UNCOVERED                          | PASS   | Demonstrates why pending-creation semantics require a decision.                                                                                                 |
| T04 | Strict coverage would refuse suspension of a compromised sole operator                      | BLOCKED                            | BLOCKED                            | PASS   | Correct result under strict preservation, but an unresolved security tradeoff, not an endorsed recovery policy.                                                 |
| T05 | Provisional unusable account does not count as coverage                                     | UNCOVERED                          | UNCOVERED                          | PASS   | Eligible means usable active account, not merely a configured role.                                                                                             |
| T06 | Creator assigns another editor and omits self                                               | [false,true,0]                     | [false,true,0]                     | PASS   | Desired final access state only; named-user storage and creation API are not implemented.                                                                       |
| T07 | Erasure authority does not imply viewing/export                                             | [true,false,false]                 | [true,false,false]                 | PASS   | Response reading/export remains a separate capability.                                                                                                          |
| T08 | Closed form with enabled reopening still needs operations coverage                          | UNCOVERED                          | UNCOVERED                          | PASS   | Closed is not retired; only explicitly retired operations stop requiring coverage.                                                                              |
| T09 | Retained responses need response-management coverage                                        | ["responses","erase"]              | ["responses","erase"]              | PASS   | Lifecycle policy is proposed; retained data cannot silently lose enabled duties.                                                                                |
| T10 | 100 accounts but only one publisher is insufficient for independent approval                | BLOCKED                            | BLOCKED                            | PASS   | Count authorised people, not headcount.                                                                                                                         |
| T11 | Disabling the only independent publisher loses approval coverage                            | BLOCKED                            | BLOCKED                            | PASS   | Permission and eligibility must be rechecked when an approval is applied.                                                                                       |
| T12 | Another group can preserve access after one membership is removed                           | true                               | true                               | PASS   | Effective access is the union of remaining grants.                                                                                                              |
| T13 | Editor inherits viewing but not creation in another workspace                               | [true,false]                       | [true,false]                       | PASS   | Creation-only workspace membership is separate.                                                                                                                 |
| T14 | Erasure can be allowed in test without prod                                                 | [true,false]                       | [true,false]                       | PASS   | Environment selection is explicit and not restricted to production.                                                                                             |
| T15 | One publisher different from a frozen version author can approve that exact version         | true                               | true                               | PASS   | Exact-request eligibility differs from blanket future readiness requiring two publishers. This distinction needs lifecycle/publishing-flow treatment.           |
| T16 | Last active Installation administrator cannot be demoted                                    | ["installation"]                   | ["installation"]                   | PASS   | Administrator continuity is separate from form task coverage.                                                                                                   |
| T17 | Installation privilege does not replace explicit Workspace administrator membership         | ["W0"]                             | ["W0"]                             | PASS   | An installation role alone does not satisfy the workspace membership invariant.                                                                                 |
| T18 | Atomic Workspace administrator handover preserves continuity                                | []                                 | []                                 | PASS   | The replacement must be an eligible account; final state is checked together.                                                                                   |
| T19 | Disabling sole administrator affects every workspace                                        | ["installation","W0","W1"]         | ["installation","W0","W1"]         | PASS   | Strict continuity flags all affected duties. Emergency suspension still needs an explicit policy.                                                               |
| T20 | Two uncoordinated Workspace administrator removals can violate continuity                   | [0,0,1]                            | [0,0,1]                            | PASS   | Another stale-read counterexample; no real transaction locking is tested.                                                                                       |
| T21 | Different form groups stay isolated within one workspace                                    | [true,false,true,false]            | [true,false,true,false]            | PASS   | Creation membership and another person's group cannot supply access to the other form.                                                                          |
| T22 | Non-empty independent role environment scopes                                               | [true,false,true,false,true,false] | [true,false,true,false,true,false] | PASS   | Publishing=test; response reading=prod; erasure=test. Each has an allowed and refused probe.                                                                    |
| T23 | Rescoping the sole F1 editing group can uncover F1                                          | [true,false]                       | [true,false]                       | PASS   | An ordinary-change coverage guard must refuse this state until F1 has a replacement.                                                                            |
| T24 | Roles on different forms cannot combine into publishing authority                           | [true,true,false]                  | [true,true,false]                  | PASS   | Editing F1 plus publishing F2 does not permit publishing F1.                                                                                                    |
| T25 | Publisher for another form cannot supply an independent approver                            | BLOCKED                            | BLOCKED                            | PASS   | The second person needs the exact form/environment authority.                                                                                                   |
| T26 | Overlapping membership preserves only actual form permissions                               | [true,true,false,false]            | [true,true,false,false]            | PASS   | The remaining F1 editor group preserves F1 editing; the F2 viewer group grants neither F2 editing nor publishing.                                               |
| T27 | Emergency account suspension is immediate despite sole-operator coverage                    | SUSPENDED                          | SUSPENDED                          | PASS   | Accepted security exception; affected actions are blocked and audited until authorised replacement.                                                             |
| T28 | One account suspension makes all group permissions ineffective without deleting memberships | [false,false,0,true]               | [false,false,0,true]               | PASS   | Sessions and effective permissions are invalidated globally; memberships remain as records. This is a model transition, not an authentication integration test. |
| T29 | Emergency suspension may leave last-administrator duties uncovered for operator recovery    | ["installation","W0"]              | ["installation","W0"]              | PASS   | The accepted emergency exception is distinct from ordinary succession. No implicit replacement access is granted.                                               |
| T30 | Ordinary removal still requires coverage-preserving handover                                | REFUSED                            | REFUSED                            | PASS   | Emergency mode is explicit and audited; ordinary changes retain the no-orphan guard.                                                                            |
| T31 | Initial approval holds the entire creation request                                          | [false,false,"AWAITING_APPROVAL"]  | [false,false,"AWAITING_APPROVAL"]  | PASS   | No active form or grants exist while initial approval is pending. An active eligible editor is still required before applying the request.                      |
| T32 | Approved creation applies form and group assignments together                               | [true,true,true]                   | [true,true,true]                   | PASS   | Group-only desired-state fixture; actual transaction/approval versioning and authority remain application work.                                                 |
| T33 | A draft does not require a standing second publisher                                        | READY                              | READY                              | PASS   | Independent approval is checked when the protected action is requested, not as a permanent two-publisher form invariant.                                        |
| T34 | Protected publishing checks a different eligible person for the exact request               | READY                              | READY                              | PASS   | A named requester has a different active publisher on the same form/environment; unrelated users cannot substitute.                                             |
| T35 | Creation refuses an assigned group with no eligible editor                                  | [false,"REFUSED"]                  | [false,"REFUSED"]                  | PASS   | Draft editor coverage is revalidated before a form becomes active.                                                                                              |
| T36 | Initial publisher/view permission cannot substitute for editing                             | REFUSED                            | REFUSED                            | PASS   | Viewing inherited from Publish forms does not satisfy the editor obligation.                                                                                    |
| T37 | Creation approval rechecks editor eligibility before committing                             | REFUSED                            | REFUSED                            | PASS   | A queued request does not freeze the eligibility of its group holders.                                                                                          |
| T38 | Creation approval refuses a requester who lost creation permission                          | REFUSED                            | REFUSED                            | PASS   | Recheck current authority at application, not merely at request submission.                                                                                     |
| T39 | Independent approval cannot replace missing requester permission                            | BLOCKED                            | BLOCKED                            | PASS   | Both requester authority and a different eligible approver are rechecked for the exact protected action.                                                        |

## Full configuration matrix

Users are total accounts in the fixture. Forms are per workspace. READY/BLOCKED is the observed collecting-readiness outcome; assertions pass only when this matches the independently derived expected outcome and all refusal/coverage probes match.

| ID   | Users | Environments    | Workspaces | Forms/workspace | Arrangement         | Form groups | Approval variant | Minimum people/workspace | Expected | Actual  | Assertions |
| ---- | ----- | --------------- | ---------- | --------------- | ------------------- | ----------- | ---------------- | ------------------------ | -------- | ------- | ---------- |
| C001 | 1     | test            | 1          | 1               | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C002 | 1     | test            | 1          | 1               | shared              | 1           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C003 | 1     | test            | 1          | 1               | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C004 | 1     | test            | 1          | 1               | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C005 | 1     | test            | 1          | 1               | departmental        | 4           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C006 | 1     | test            | 1          | 1               | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C007 | 1     | test            | 1          | 10              | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C008 | 1     | test            | 1          | 10              | shared              | 1           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C009 | 1     | test            | 1          | 10              | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C010 | 1     | test            | 1          | 10              | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C011 | 1     | test            | 1          | 10              | departmental        | 4           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C012 | 1     | test            | 1          | 10              | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C013 | 1     | test            | 3          | 1               | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C014 | 1     | test            | 3          | 1               | shared              | 3           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C015 | 1     | test            | 3          | 1               | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C016 | 1     | test            | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C017 | 1     | test            | 3          | 1               | departmental        | 12          | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C018 | 1     | test            | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C019 | 1     | test            | 3          | 10              | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C020 | 1     | test            | 3          | 10              | shared              | 3           | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C021 | 1     | test            | 3          | 10              | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C022 | 1     | test            | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C023 | 1     | test            | 3          | 10              | departmental        | 12          | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C024 | 1     | test            | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C025 | 1     | prod            | 1          | 1               | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C026 | 1     | prod            | 1          | 1               | shared              | 1           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C027 | 1     | prod            | 1          | 1               | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C028 | 1     | prod            | 1          | 1               | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C029 | 1     | prod            | 1          | 1               | departmental        | 4           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C030 | 1     | prod            | 1          | 1               | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C031 | 1     | prod            | 1          | 10              | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C032 | 1     | prod            | 1          | 10              | shared              | 1           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C033 | 1     | prod            | 1          | 10              | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C034 | 1     | prod            | 1          | 10              | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C035 | 1     | prod            | 1          | 10              | departmental        | 4           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C036 | 1     | prod            | 1          | 10              | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C037 | 1     | prod            | 3          | 1               | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C038 | 1     | prod            | 3          | 1               | shared              | 3           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C039 | 1     | prod            | 3          | 1               | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C040 | 1     | prod            | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C041 | 1     | prod            | 3          | 1               | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C042 | 1     | prod            | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C043 | 1     | prod            | 3          | 10              | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C044 | 1     | prod            | 3          | 10              | shared              | 3           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C045 | 1     | prod            | 3          | 10              | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C046 | 1     | prod            | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C047 | 1     | prod            | 3          | 10              | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C048 | 1     | prod            | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C049 | 1     | dev, test, prod | 1          | 1               | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C050 | 1     | dev, test, prod | 1          | 1               | shared              | 1           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C051 | 1     | dev, test, prod | 1          | 1               | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C052 | 1     | dev, test, prod | 1          | 1               | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C053 | 1     | dev, test, prod | 1          | 1               | departmental        | 4           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C054 | 1     | dev, test, prod | 1          | 1               | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C055 | 1     | dev, test, prod | 1          | 10              | shared              | 1           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C056 | 1     | dev, test, prod | 1          | 10              | shared              | 1           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C057 | 1     | dev, test, prod | 1          | 10              | shared              | 1           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C058 | 1     | dev, test, prod | 1          | 10              | departmental        | 4           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C059 | 1     | dev, test, prod | 1          | 10              | departmental        | 4           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C060 | 1     | dev, test, prod | 1          | 10              | departmental        | 4           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C061 | 1     | dev, test, prod | 3          | 1               | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C062 | 1     | dev, test, prod | 3          | 1               | shared              | 3           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C063 | 1     | dev, test, prod | 3          | 1               | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C064 | 1     | dev, test, prod | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C065 | 1     | dev, test, prod | 3          | 1               | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C066 | 1     | dev, test, prod | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C067 | 1     | dev, test, prod | 3          | 10              | shared              | 3           | off              | 1                        | READY    | READY   | 12/12 PASS |
| C068 | 1     | dev, test, prod | 3          | 10              | shared              | 3           | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C069 | 1     | dev, test, prod | 3          | 10              | shared              | 3           | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C070 | 1     | dev, test, prod | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C071 | 1     | dev, test, prod | 3          | 10              | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C072 | 1     | dev, test, prod | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C073 | 2     | test            | 1          | 1               | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C074 | 2     | test            | 1          | 1               | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C075 | 2     | test            | 1          | 1               | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C076 | 2     | test            | 1          | 1               | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C077 | 2     | test            | 1          | 1               | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C078 | 2     | test            | 1          | 1               | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C079 | 2     | test            | 1          | 10              | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C080 | 2     | test            | 1          | 10              | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C081 | 2     | test            | 1          | 10              | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C082 | 2     | test            | 1          | 10              | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C083 | 2     | test            | 1          | 10              | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C084 | 2     | test            | 1          | 10              | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C085 | 2     | test            | 3          | 1               | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C086 | 2     | test            | 3          | 1               | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C087 | 2     | test            | 3          | 1               | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C088 | 2     | test            | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C089 | 2     | test            | 3          | 1               | departmental        | 12          | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C090 | 2     | test            | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C091 | 2     | test            | 3          | 10              | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C092 | 2     | test            | 3          | 10              | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C093 | 2     | test            | 3          | 10              | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C094 | 2     | test            | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C095 | 2     | test            | 3          | 10              | departmental        | 12          | prod-only        | 1                        | READY    | READY   | 12/12 PASS |
| C096 | 2     | test            | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C097 | 2     | prod            | 1          | 1               | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C098 | 2     | prod            | 1          | 1               | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C099 | 2     | prod            | 1          | 1               | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C100 | 2     | prod            | 1          | 1               | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C101 | 2     | prod            | 1          | 1               | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C102 | 2     | prod            | 1          | 1               | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C103 | 2     | prod            | 1          | 10              | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C104 | 2     | prod            | 1          | 10              | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C105 | 2     | prod            | 1          | 10              | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C106 | 2     | prod            | 1          | 10              | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C107 | 2     | prod            | 1          | 10              | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C108 | 2     | prod            | 1          | 10              | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C109 | 2     | prod            | 3          | 1               | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C110 | 2     | prod            | 3          | 1               | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C111 | 2     | prod            | 3          | 1               | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C112 | 2     | prod            | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C113 | 2     | prod            | 3          | 1               | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C114 | 2     | prod            | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C115 | 2     | prod            | 3          | 10              | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C116 | 2     | prod            | 3          | 10              | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C117 | 2     | prod            | 3          | 10              | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C118 | 2     | prod            | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C119 | 2     | prod            | 3          | 10              | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C120 | 2     | prod            | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C121 | 2     | dev, test, prod | 1          | 1               | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C122 | 2     | dev, test, prod | 1          | 1               | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C123 | 2     | dev, test, prod | 1          | 1               | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C124 | 2     | dev, test, prod | 1          | 1               | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C125 | 2     | dev, test, prod | 1          | 1               | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C126 | 2     | dev, test, prod | 1          | 1               | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C127 | 2     | dev, test, prod | 1          | 10              | shared              | 1           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C128 | 2     | dev, test, prod | 1          | 10              | shared              | 1           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C129 | 2     | dev, test, prod | 1          | 10              | shared              | 1           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C130 | 2     | dev, test, prod | 1          | 10              | departmental        | 4           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C131 | 2     | dev, test, prod | 1          | 10              | departmental        | 4           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C132 | 2     | dev, test, prod | 1          | 10              | departmental        | 4           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C133 | 2     | dev, test, prod | 3          | 1               | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C134 | 2     | dev, test, prod | 3          | 1               | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C135 | 2     | dev, test, prod | 3          | 1               | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C136 | 2     | dev, test, prod | 3          | 1               | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C137 | 2     | dev, test, prod | 3          | 1               | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C138 | 2     | dev, test, prod | 3          | 1               | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C139 | 2     | dev, test, prod | 3          | 10              | shared              | 3           | off              | 2                        | READY    | READY   | 12/12 PASS |
| C140 | 2     | dev, test, prod | 3          | 10              | shared              | 3           | prod-only        | 2                        | READY    | READY   | 12/12 PASS |
| C141 | 2     | dev, test, prod | 3          | 10              | shared              | 3           | all-environments | 2                        | READY    | READY   | 12/12 PASS |
| C142 | 2     | dev, test, prod | 3          | 10              | departmental        | 12          | off              | 1                        | READY    | READY   | 12/12 PASS |
| C143 | 2     | dev, test, prod | 3          | 10              | departmental        | 12          | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C144 | 2     | dev, test, prod | 3          | 10              | departmental        | 12          | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C145 | 10    | test            | 1          | 1               | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C146 | 10    | test            | 1          | 1               | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C147 | 10    | test            | 1          | 1               | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C148 | 10    | test            | 1          | 1               | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C149 | 10    | test            | 1          | 1               | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C150 | 10    | test            | 1          | 1               | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C151 | 10    | test            | 1          | 10              | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C152 | 10    | test            | 1          | 10              | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C153 | 10    | test            | 1          | 10              | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C154 | 10    | test            | 1          | 10              | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C155 | 10    | test            | 1          | 10              | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C156 | 10    | test            | 1          | 10              | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C157 | 10    | test            | 3          | 1               | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C158 | 10    | test            | 3          | 1               | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C159 | 10    | test            | 3          | 1               | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C160 | 10    | test            | 3          | 1               | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C161 | 10    | test            | 3          | 1               | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C162 | 10    | test            | 3          | 1               | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C163 | 10    | test            | 3          | 10              | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C164 | 10    | test            | 3          | 10              | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C165 | 10    | test            | 3          | 10              | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C166 | 10    | test            | 3          | 10              | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C167 | 10    | test            | 3          | 10              | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C168 | 10    | test            | 3          | 10              | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C169 | 10    | prod            | 1          | 1               | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C170 | 10    | prod            | 1          | 1               | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C171 | 10    | prod            | 1          | 1               | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C172 | 10    | prod            | 1          | 1               | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C173 | 10    | prod            | 1          | 1               | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C174 | 10    | prod            | 1          | 1               | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C175 | 10    | prod            | 1          | 10              | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C176 | 10    | prod            | 1          | 10              | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C177 | 10    | prod            | 1          | 10              | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C178 | 10    | prod            | 1          | 10              | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C179 | 10    | prod            | 1          | 10              | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C180 | 10    | prod            | 1          | 10              | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C181 | 10    | prod            | 3          | 1               | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C182 | 10    | prod            | 3          | 1               | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C183 | 10    | prod            | 3          | 1               | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C184 | 10    | prod            | 3          | 1               | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C185 | 10    | prod            | 3          | 1               | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C186 | 10    | prod            | 3          | 1               | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C187 | 10    | prod            | 3          | 10              | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C188 | 10    | prod            | 3          | 10              | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C189 | 10    | prod            | 3          | 10              | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C190 | 10    | prod            | 3          | 10              | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C191 | 10    | prod            | 3          | 10              | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C192 | 10    | prod            | 3          | 10              | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C193 | 10    | dev, test, prod | 1          | 1               | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C194 | 10    | dev, test, prod | 1          | 1               | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C195 | 10    | dev, test, prod | 1          | 1               | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C196 | 10    | dev, test, prod | 1          | 1               | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C197 | 10    | dev, test, prod | 1          | 1               | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C198 | 10    | dev, test, prod | 1          | 1               | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C199 | 10    | dev, test, prod | 1          | 10              | shared              | 1           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C200 | 10    | dev, test, prod | 1          | 10              | shared              | 1           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C201 | 10    | dev, test, prod | 1          | 10              | shared              | 1           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C202 | 10    | dev, test, prod | 1          | 10              | departmental        | 4           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C203 | 10    | dev, test, prod | 1          | 10              | departmental        | 4           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C204 | 10    | dev, test, prod | 1          | 10              | departmental        | 4           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C205 | 10    | dev, test, prod | 3          | 1               | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C206 | 10    | dev, test, prod | 3          | 1               | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C207 | 10    | dev, test, prod | 3          | 1               | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C208 | 10    | dev, test, prod | 3          | 1               | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C209 | 10    | dev, test, prod | 3          | 1               | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C210 | 10    | dev, test, prod | 3          | 1               | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C211 | 10    | dev, test, prod | 3          | 10              | shared              | 3           | off              | 10                       | READY    | READY   | 12/12 PASS |
| C212 | 10    | dev, test, prod | 3          | 10              | shared              | 3           | prod-only        | 10                       | READY    | READY   | 12/12 PASS |
| C213 | 10    | dev, test, prod | 3          | 10              | shared              | 3           | all-environments | 10                       | READY    | READY   | 12/12 PASS |
| C214 | 10    | dev, test, prod | 3          | 10              | departmental        | 12          | off              | 3                        | READY    | READY   | 12/12 PASS |
| C215 | 10    | dev, test, prod | 3          | 10              | departmental        | 12          | prod-only        | 3                        | READY    | READY   | 12/12 PASS |
| C216 | 10    | dev, test, prod | 3          | 10              | departmental        | 12          | all-environments | 3                        | READY    | READY   | 12/12 PASS |
| C217 | 100   | test            | 1          | 1               | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C218 | 100   | test            | 1          | 1               | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C219 | 100   | test            | 1          | 1               | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C220 | 100   | test            | 1          | 1               | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C221 | 100   | test            | 1          | 1               | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C222 | 100   | test            | 1          | 1               | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C223 | 100   | test            | 1          | 10              | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C224 | 100   | test            | 1          | 10              | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C225 | 100   | test            | 1          | 10              | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C226 | 100   | test            | 1          | 10              | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C227 | 100   | test            | 1          | 10              | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C228 | 100   | test            | 1          | 10              | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C229 | 100   | test            | 3          | 1               | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C230 | 100   | test            | 3          | 1               | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C231 | 100   | test            | 3          | 1               | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C232 | 100   | test            | 3          | 1               | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C233 | 100   | test            | 3          | 1               | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C234 | 100   | test            | 3          | 1               | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C235 | 100   | test            | 3          | 10              | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C236 | 100   | test            | 3          | 10              | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C237 | 100   | test            | 3          | 10              | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C238 | 100   | test            | 3          | 10              | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C239 | 100   | test            | 3          | 10              | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C240 | 100   | test            | 3          | 10              | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C241 | 100   | prod            | 1          | 1               | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C242 | 100   | prod            | 1          | 1               | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C243 | 100   | prod            | 1          | 1               | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C244 | 100   | prod            | 1          | 1               | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C245 | 100   | prod            | 1          | 1               | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C246 | 100   | prod            | 1          | 1               | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C247 | 100   | prod            | 1          | 10              | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C248 | 100   | prod            | 1          | 10              | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C249 | 100   | prod            | 1          | 10              | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C250 | 100   | prod            | 1          | 10              | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C251 | 100   | prod            | 1          | 10              | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C252 | 100   | prod            | 1          | 10              | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C253 | 100   | prod            | 3          | 1               | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C254 | 100   | prod            | 3          | 1               | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C255 | 100   | prod            | 3          | 1               | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C256 | 100   | prod            | 3          | 1               | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C257 | 100   | prod            | 3          | 1               | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C258 | 100   | prod            | 3          | 1               | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C259 | 100   | prod            | 3          | 10              | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C260 | 100   | prod            | 3          | 10              | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C261 | 100   | prod            | 3          | 10              | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C262 | 100   | prod            | 3          | 10              | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C263 | 100   | prod            | 3          | 10              | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C264 | 100   | prod            | 3          | 10              | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C265 | 100   | dev, test, prod | 1          | 1               | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C266 | 100   | dev, test, prod | 1          | 1               | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C267 | 100   | dev, test, prod | 1          | 1               | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C268 | 100   | dev, test, prod | 1          | 1               | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C269 | 100   | dev, test, prod | 1          | 1               | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C270 | 100   | dev, test, prod | 1          | 1               | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C271 | 100   | dev, test, prod | 1          | 10              | shared              | 1           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C272 | 100   | dev, test, prod | 1          | 10              | shared              | 1           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C273 | 100   | dev, test, prod | 1          | 10              | shared              | 1           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C274 | 100   | dev, test, prod | 1          | 10              | departmental        | 4           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C275 | 100   | dev, test, prod | 1          | 10              | departmental        | 4           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C276 | 100   | dev, test, prod | 1          | 10              | departmental        | 4           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C277 | 100   | dev, test, prod | 3          | 1               | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C278 | 100   | dev, test, prod | 3          | 1               | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C279 | 100   | dev, test, prod | 3          | 1               | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C280 | 100   | dev, test, prod | 3          | 1               | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C281 | 100   | dev, test, prod | 3          | 1               | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C282 | 100   | dev, test, prod | 3          | 1               | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C283 | 100   | dev, test, prod | 3          | 10              | shared              | 3           | off              | 100                      | READY    | READY   | 12/12 PASS |
| C284 | 100   | dev, test, prod | 3          | 10              | shared              | 3           | prod-only        | 100                      | READY    | READY   | 12/12 PASS |
| C285 | 100   | dev, test, prod | 3          | 10              | shared              | 3           | all-environments | 100                      | READY    | READY   | 12/12 PASS |
| C286 | 100   | dev, test, prod | 3          | 10              | departmental        | 12          | off              | 33                       | READY    | READY   | 12/12 PASS |
| C287 | 100   | dev, test, prod | 3          | 10              | departmental        | 12          | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C288 | 100   | dev, test, prod | 3          | 10              | departmental        | 12          | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C289 | 1000  | test            | 1          | 1               | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C290 | 1000  | test            | 1          | 1               | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C291 | 1000  | test            | 1          | 1               | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C292 | 1000  | test            | 1          | 1               | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C293 | 1000  | test            | 1          | 1               | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C294 | 1000  | test            | 1          | 1               | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C295 | 1000  | test            | 1          | 10              | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C296 | 1000  | test            | 1          | 10              | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C297 | 1000  | test            | 1          | 10              | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C298 | 1000  | test            | 1          | 10              | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C299 | 1000  | test            | 1          | 10              | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C300 | 1000  | test            | 1          | 10              | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C301 | 1000  | test            | 3          | 1               | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C302 | 1000  | test            | 3          | 1               | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C303 | 1000  | test            | 3          | 1               | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C304 | 1000  | test            | 3          | 1               | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C305 | 1000  | test            | 3          | 1               | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C306 | 1000  | test            | 3          | 1               | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C307 | 1000  | test            | 3          | 10              | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C308 | 1000  | test            | 3          | 10              | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C309 | 1000  | test            | 3          | 10              | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C310 | 1000  | test            | 3          | 10              | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C311 | 1000  | test            | 3          | 10              | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C312 | 1000  | test            | 3          | 10              | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C313 | 1000  | prod            | 1          | 1               | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C314 | 1000  | prod            | 1          | 1               | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C315 | 1000  | prod            | 1          | 1               | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C316 | 1000  | prod            | 1          | 1               | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C317 | 1000  | prod            | 1          | 1               | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C318 | 1000  | prod            | 1          | 1               | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C319 | 1000  | prod            | 1          | 10              | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C320 | 1000  | prod            | 1          | 10              | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C321 | 1000  | prod            | 1          | 10              | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C322 | 1000  | prod            | 1          | 10              | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C323 | 1000  | prod            | 1          | 10              | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C324 | 1000  | prod            | 1          | 10              | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C325 | 1000  | prod            | 3          | 1               | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C326 | 1000  | prod            | 3          | 1               | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C327 | 1000  | prod            | 3          | 1               | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C328 | 1000  | prod            | 3          | 1               | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C329 | 1000  | prod            | 3          | 1               | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C330 | 1000  | prod            | 3          | 1               | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C331 | 1000  | prod            | 3          | 10              | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C332 | 1000  | prod            | 3          | 10              | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C333 | 1000  | prod            | 3          | 10              | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C334 | 1000  | prod            | 3          | 10              | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C335 | 1000  | prod            | 3          | 10              | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C336 | 1000  | prod            | 3          | 10              | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C337 | 1000  | dev, test, prod | 1          | 1               | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C338 | 1000  | dev, test, prod | 1          | 1               | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C339 | 1000  | dev, test, prod | 1          | 1               | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C340 | 1000  | dev, test, prod | 1          | 1               | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C341 | 1000  | dev, test, prod | 1          | 1               | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C342 | 1000  | dev, test, prod | 1          | 1               | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C343 | 1000  | dev, test, prod | 1          | 10              | shared              | 1           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C344 | 1000  | dev, test, prod | 1          | 10              | shared              | 1           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C345 | 1000  | dev, test, prod | 1          | 10              | shared              | 1           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C346 | 1000  | dev, test, prod | 1          | 10              | departmental        | 4           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C347 | 1000  | dev, test, prod | 1          | 10              | departmental        | 4           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C348 | 1000  | dev, test, prod | 1          | 10              | departmental        | 4           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C349 | 1000  | dev, test, prod | 3          | 1               | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C350 | 1000  | dev, test, prod | 3          | 1               | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C351 | 1000  | dev, test, prod | 3          | 1               | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C352 | 1000  | dev, test, prod | 3          | 1               | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C353 | 1000  | dev, test, prod | 3          | 1               | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C354 | 1000  | dev, test, prod | 3          | 1               | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C355 | 1000  | dev, test, prod | 3          | 10              | shared              | 3           | off              | 1000                     | READY    | READY   | 12/12 PASS |
| C356 | 1000  | dev, test, prod | 3          | 10              | shared              | 3           | prod-only        | 1000                     | READY    | READY   | 12/12 PASS |
| C357 | 1000  | dev, test, prod | 3          | 10              | shared              | 3           | all-environments | 1000                     | READY    | READY   | 12/12 PASS |
| C358 | 1000  | dev, test, prod | 3          | 10              | departmental        | 12          | off              | 333                      | READY    | READY   | 12/12 PASS |
| C359 | 1000  | dev, test, prod | 3          | 10              | departmental        | 12          | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C360 | 1000  | dev, test, prod | 3          | 10              | departmental        | 12          | all-environments | 333                      | READY    | READY   | 12/12 PASS |
| C361 | 1     | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | off              | 1                        | READY    | READY   | 12/12 PASS |
| C362 | 1     | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | prod-only        | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C363 | 1     | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | all-environments | 1                        | BLOCKED  | BLOCKED | 12/12 PASS |
| C364 | 100   | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | off              | 33                       | READY    | READY   | 12/12 PASS |
| C365 | 100   | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | prod-only        | 33                       | READY    | READY   | 12/12 PASS |
| C366 | 100   | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | all-environments | 33                       | READY    | READY   | 12/12 PASS |
| C367 | 1000  | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | off              | 333                      | READY    | READY   | 12/12 PASS |
| C368 | 1000  | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | prod-only        | 333                      | READY    | READY   | 12/12 PASS |
| C369 | 1000  | dev, test, prod | 3          | 10              | 1,000-group fixture | 1000        | all-environments | 333                      | READY    | READY   | 12/12 PASS |

## Accepted decisions and implementation work still required

1. Implement accepted lifecycle checkpoints, including retained-data and still-enabled operations after closure.
2. Implement groups-only initial access without changing unrelated group memberships. Response-access administration remains a separate authorised task.
3. Implement whole-request pending creation: no active form before approval, atomic form/assignment creation afterward.
4. Specify the audited operator recovery procedure after accepted emergency suspension, including the last administrator.
5. Implement action-specific approver eligibility and determine policy environment coverage; freeze/version the exact protected request.

## Evidence and implementation boundary

- [Machine-readable full results](workspace-access-scenario-results.json)
- [Reproducible scenario runner](workspace-access-scenarios.mjs)
- [Readable HTML report](workspace-access-scenario-results.html)
- [Access user guide](workspace-access-explainer.html)
- [Design and current-code comparison](workspace-access-completeness.md)

Application/API/database integration, real offboarding and approval workflows, UI usability with 100/1,000 people, query bounds, load/throughput and actual race safety remain unverified for the new design.
