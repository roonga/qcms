HANDOFF: AWAITING-HUMAN rulings on the five phase 6 design questions below

Issue #1204, phase 6 of `plan/environment-navigation-implementation.md`. The settled part
of the scope has landed on this branch with its gates green. Each question below stops a
named part of the remaining scope, and none of them is settled by the plan, by the
"Preserve these invariants" list, by the "Verification and acceptance" journeys or by the
phase 1 rulings in `plan/environment-phase1-decisions.md`. No choice below has been made
in code.

## 1. Which shell mode owns a form-scoped operational route reached from Operations

Blocks: the plan's "Operations" row of the navigation table ("Selecting a form reveals its
permitted Overview, Responses, Links and Webhooks rail") and its "Routes and application
integration" line "map selected-form Responses/Links/Webhooks routes to their matching
form/environment contexts".

Today `lib/shell/modes.ts` gives Operations the routes `/operations`, `/responses` and
`/webhooks`, and normal mode `/questions` and `/forms`. So `/forms/{id}/responses` is a
normal-mode route whichever screen sent the operator there, and leaving Operations drops
the mode header and with it the environment selector. The links this branch adds inherit
that, exactly as the interim `/forms/{id}` link did.

- **Option A: Operations-owned routes.** Add `/operations/forms/{formId}/{responses,links,
  webhooks,versions}` and send the table's links there. Clean mode separation and an
  explicit URL for the Operations context, as the plan asks for elsewhere. Costs a second
  route per screen, a second rail slot per screen and a redirect policy for the existing
  addresses.
- **Option B: pattern-matched mode ownership.** Teach the mode table that the operational
  suffixes of `/forms/{id}` belong to Operations. One route each, but an editor walking
  from the normal Forms list into a form's Responses would also lose the normal menus, so
  it changes the authoring journey.
- **Option C: leave the mode as it is** and accept that an operational context is a normal
  route. Cheapest, and it leaves a response-only caller on a screen with no environment
  indicator and no way back to Operations, which reads against phase 4's "focused mode
  never reveals inaccessible normal navigation" in the other direction.

**Recommendation: A.** It is the only option that gives the Operations context its own
address, which the plan asks for in two places, and the only one that does not change a
journey phase 4 already shipped. Its cost is real but mechanical.

## 2. What an Operations "Overview" context is

Blocks: the "Overview" rail row in the navigation table and in Q87's "Rails offered"
column.

`/forms/{id}` is the builder. A `forms.viewer` can open it and sees it read-only; it is
still an authoring screen, and Q87 lists Overview for a viewer, an editor and an approver
alike. There is no operational overview screen today.

- **Option A: Overview is the form's own screen**, as this branch's `form` context treats
  it. No new screen; the name in the plan then describes the builder in read-only dress.
- **Option B: a new per-form operational overview** under the Operations context: what the
  selected environment serves, intake, last release, counts the caller may see, and links
  to the other contexts.

**Recommendation: B, after question 1.** A viewer opening a builder to read what an
environment serves is the interim behaviour rather than the destination, and option B is
the screen Q87's column reads like. A is what ships until it is built.

## 3. Where a claim-only caller's global queue reads its form identities from

Blocks: G06 ("Support Operations entry with only authorized global destinations and no
forced form-list access") on `/webhooks`.

The delivery-failures screen and its rail read `GET /admin/forms` for the form filter's
options, the rail's per-form rows and the page's form picker. That route needs
`form: read`, which an installation claim alone does not hold (G03, G06), so a claim-only
caller meets a warning alert about forms it may not read. Dropping the read leaves the
filter with raw form ids, because a dead-letter row carries `formId` and no slug, and
`GET /admin/operations/forms` returns that caller nothing by Q87.

- **Option A: add the form's slug to the dead-letter row.** The queue is already
  installation-only and carries delivery state; a slug is identification of the same kind
  as the form id already there. One API field, no new route.
- **Option B: drop the form filter and the per-form links** from the global queue and
  reach per-form configuration from the Operations table alone.
- **Option C: leave it**, and keep a warning a claim-only caller can do nothing about.

**Recommendation: A**, with the per-form links kept but the page's whole-installation form
picker dropped: the Operations table is the forms picker the plan asks for, and G04 means a
queue reader holds no retry on a form anyway.

## 4. The G05 eraser known-target screen, and `docs/erasure.md`

Blocks: Q87's G05 steps 1 to 4, F3's dispose journey, and the user documentation the plan
defers to this phase.

Q87 specifies the journey (a session id field, `erasure-scope`, type-to-confirm, the Q7
repetition per other environment, and the same shape for dispose) but not where it lives.
With question 1 open there is no settled address for it, and the screen is also the subject
of the `docs/erasure.md` text this phase owes.

- **Option A: a route under the Operations form context** from question 1.
- **Option B: a panel on the existing per-form responses route**, shown when the caller
  holds `response: erase` or `response: dispose` and no `response: read`.

**Recommendation: A**, so the eraser's journey is addressable and bookmarkable like every
other operational context. It depends on question 1 and should follow it.

## 5. The workspace-mode surface

Blocks: the issue's "workspace mode" clause.

Workspaces mode exists with its own header, landing list and remembered workspace. The
plan's navigation table names its rail rows as Members, Access groups, Workspace settings
and Access audit. Which of those are already shipped screens, which are routes to add, and
whether access groups are a screen of their own or part of Members, is not settled here,
and no invariant or journey in the plan decides it.

**Recommendation:** rule this as its own work package against the current
`/workspaces/{workspaceId}` screens rather than inside phase 6, since nothing in it is
environment-scoped and it shares no seam with the operational contexts above.
