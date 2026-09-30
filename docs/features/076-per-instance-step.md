# 076 - The per-instance step presentation

**Stage:** 8c (launch scope) · **Apps/packages:** `apps/api` (the view list and the cursor), `apps/portal`, `apps/admin` (the presentation switch and the preview) · **Depends on:** 073
**References:** ADR-43 · ADR-42 · ADR-28 as amended 2026-09-29 (the cursor indexes `visibleStepViews`) and as amended 2026-08-31 (the no-JS fallback is one readiness-labelled button with no Back) · `plan/repeating-groups-and-table-input.md` section 12 and Q22 · R1 · I4

## Context

`presentation: "perInstanceStep"` paginates one step's group into one page per live instance. It is the presentation a phone benefits from most, and it is the one that touches navigation, so it is the one ADR-28 has something to say about.

The amendment of 2026-09-29 settles the addressing: a step id no longer identifies a page, so the cursor indexes **`visibleStepViews`**, a list of `(stepId, instanceId | null)` with the instance null for every page that is not a per-instance one. It stays a 0-based index into a list the server computed for this session on this request, which is what makes an out-of-range value refusable by arithmetic and an in-range value a view the server had already decided was visible. A compound cursor on the wire was refused for that reason, and not because an instance id is secret: an instance id is already in field names, DOM ids, anchors and the no-JS fragment.

## Deliverables

- **`visibleStepViews` populated** by the evaluator's optional field (071 added the field; this task is what fills and uses it), in document order for steps and roster order for instances.
- **The cursor indexing views**, `progress: {stepIndex, totalVisibleSteps}` counting views, Back returning one view, Continue advancing one view, and Submit appearing on the last. A three-instance group is three views and the progress indicator says three.
- **ADR-28's rule held**: answering never moves the page by itself, on either path.
- **A form with no repeating group is unaffected**: one view per visible step, every number what it is today, asserted rather than assumed.
- **The no-JS walk, stated because ADR-28's amendment makes it a design question rather than a detail.** That amendment says the no-JS fallback is a **single readiness-labelled button with no Back control**, so "Back and Continue traverse the views" cannot be a claim about both paths. Without scripting a `perInstanceStep` group serves **the first view whose instance is incomplete**, the single button submits and the server chooses the next view, and the group's **Add control appears on the last view** so an open-ended group can still grow. There is no Back on that path, exactly as the amendment says, and the respondent reaches an earlier instance through the review step rather than through a control this task adds.
- **The admin's presentation switch reaching it**, and the preview walking the views through the same renderer the portal uses.
- **Localised chrome** for the view-level labels (ADR-27).

## Notes from task 071 on `visibleStepViews`

Task 071 built the list this task's cursor walks, and left **two edges for this task to decide** rather than deciding them in the kernel (recorded on the review of PR #1016, 2026-09-29):

- A view is emitted for a live instance **all of whose members are hidden**, where `visibleSteps` omits a step with nothing visible. The two fields therefore disagree about emptiness, deliberately: `visibleSteps` is derived from `visible` and the view list is derived from the roster.
- **Only the first `perInstanceStep` group in a step paginates it.** A step holding two of them is not a shape any presentation has defined, and the kernel picks the first rather than inventing a reading.

Changing either is a change to `packages/core/src/evaluate-rules.ts`'s `stepViews`, and it belongs here because the cursor is what gives a view its meaning.

## Exit criteria

**This task owns no numbered acceptance case**, and section 11 of the plan says so in its ownership map. Its behaviour is a claim about a sequence rather than about a value, so the criterion is prose and it is the whole specification:

1. On the hydrated path, a three-instance group presents as **three views**, the progress indicator says three, and Back and Continue traverse them in **roster order**.
2. ADR-28's rule that answering never moves the rendered page by itself holds on both paths, asserted by answering a field in a view and observing no navigation.
3. On the no-JS path the walk completes through all three views with **one button and no Back**, and the group's **Add control is on the last view**.
4. A form with no repeating group produces the same view list, the same progress numbers and the same navigation it produces today, asserted against the existing fixtures.
5. Submit appears on the last view and nowhere earlier, including when the last view belongs to an instance rather than to a plain step.
6. `pnpm verify` green; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` green, run detached, since this touches `apps/portal` and `apps/admin`.

## Files and areas

The step projection and cursor handling in `apps/api/src/features/responses/`, the portal's step route and navigation chrome, the admin's group panel presentation switch and `draft-preview.tsx`, the portal and admin i18n catalogs.

## Gates

`pnpm verify`, and `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` run detached (`verify:browser:detached`, then `verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground: issue #846). No Docker-backed gate unless the cursor change reaches a boot-environment path, which it should not.

## Out of scope (binding)

**This is inside the launch cut-line and may not be deferred.** `docs/PROJECT_GOAL.md` section 5 promises the stacked, per-instance-step and table presentations, so task 038 waits on this. It is ordered against 077 by demand, and ordering is not scope.

Also out: a compound cursor on the wire, which was refused. Any Back control on the no-JS path, which ADR-28's amendment rules out. Instance reordering. Any change to how the roster is derived (072) or expanded (073).

## Notes for the executor

**The no-JS half is the part with a decision in it**, because ADR-28's amendment removes the control the hydrated path uses to move backwards. **Serving the first incomplete view is confirmed by the Code Owner (2026-09-29)**, so it is the rule to implement rather than a reading to revisit; if it turns out to interact badly with a group whose instances are all complete but whose step has other questions, raise that rather than inventing a second rule beside it.

**`visibleStepViews` already exists as an optional field** from 071 and is absent for a form with no group. Keep it absent: a form with no repeating group must produce a `FlowState` with no new key present, which is an acceptance case 071 owns and this task must not break.
