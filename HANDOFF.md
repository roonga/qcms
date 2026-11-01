HANDOFF: AWAITING-HUMAN review of this slice, then the three follow-up branches below

Issue #1204, phase 6 of `plan/environment-navigation-implementation.md`. The Code Owner's
rulings of 2026-11-02 settle the design questions this branch opened with, and they are
recorded in the plan's phase 6 notes. Phase 6 is larger than one reviewable change, so it
ships in slices; the workspace ruling allows that explicitly.

## This branch

The discovery row reports its read cells, the Operations table links each row to the
operational contexts that row's own cells admit, and a response viewer's Responses screen
no longer needs a form read it does not hold. Gates green.

## Branch two: the Operations-only screen move

`fix/1204-operations-only-screens`, pushed, head `f921b681`, **red and deliberately so**.
It carries the whole move and the redirects; what is left is the route registries and the
tests that enumerate them, listed in that branch's own `HANDOFF.md`. The mapping is:

| Old address                             | New address                                        |
| --------------------------------------- | -------------------------------------------------- |
| `/forms/{formId}/responses`             | `/operations/forms/{formId}/responses`             |
| `/forms/{formId}/responses/{sessionId}` | `/operations/forms/{formId}/responses/{sessionId}` |
| `/forms/{formId}/export`                | `/operations/forms/{formId}/export`                |
| `/forms/{formId}/links`                 | `/operations/forms/{formId}/links`                 |
| `/forms/{formId}/webhooks`              | `/operations/forms/{formId}/webhooks`              |

Intake close and reopen still need a host screen under Operations, which is the one screen
Q87 calls Overview: `/operations/forms/{formId}`, carrying what the selected environment
serves, its intake and the two acts, with a row in both agent tables.

## Branch three: warn before leaving Operations

Not started. The kit Dialog, Stay focused by default, Escape is Stay, focus returned;
nothing shown for navigation inside Operations; unit and Playwright coverage including
browser back. An "always leave" or "do not ask again" choice was deliberately not added:
it is a preference rather than a safety control, and if operators ask for one it belongs
with the appearance settings. That is a suggestion, not a ruling.

## Branch four: Workspaces stops being a mode, and its sections become screens

Not started, after phase 6, as that ruling allows. One branch for both workspace rulings,
since the second changes the shell's mode model and the first changes what that model
contains: a top-nav entry, left-rail screens per section, no mode switch, no Exit, with
redirects for the old addresses. It carries the #1208 access-group field rulings with it:
the environments and forms multi-selects, and a role's name and description in place of its
id.

## Branch five: one persistent rail per area, and one top bar in every area

Not started, and one branch because both are the shell's chrome. The rail becomes one
persistent tree per area with the current item's sub-items expanded in place, two levels at
most, every item a screen of its own, and the same pattern on the Workspaces rail; one
form's operations is the exception the amendment names, where the rail becomes that form's
context with a link back to all forms. The rail built on branch two
(`apps/admin/components/ops/operations-form-rail.tsx`) is the old swap-and-back-link shape
and is what this branch replaces, so order branch two before it.

## The same branch: one top bar in every area

Not started. Entering Operations shifts the layout. The bar gets one height and layout
everywhere, the environment dropdown a reserved slot, the environment edge no space of its
own, and the rail width and heading position become identical across Questions, Forms,
Workspaces and Operations, with the measure assertion the ruling specifies beside
`apps/admin/e2e/measure.pw.ts`. It touches the same shell modules as branch four, so the
two should be ordered rather than run in parallel.

## Still unruled, and outside every ruling above

- **Where a claim-only caller's global queue reads its form identities from.** `/webhooks`
  reads `GET /admin/forms` for its form filter and its links, which an installation claim
  cannot call (G03, G06), and a dead-letter row carries a form id and no slug. Options: add
  the slug to the queue row; drop the filter and the per-form links; or leave the warning.
  Recommendation: add the slug, and drop the page's whole-installation form picker, since
  the Operations table is the forms picker the plan asks for.
- **The G05 eraser known-target screen and its `docs/erasure.md` text.** Q87 specifies the
  journey and not where it lives; it belongs beside the Overview screen above.
