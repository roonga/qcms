# Adding a screen to the admin shell

A route under `apps/admin/app/(shell)` is registered in **six** places: five for every
screen, and one more for a screen that lives inside a form. Only one of them used to
announce itself, so a lane that met that one and stopped learned the same rule again and
again, one red per cycle, and the two hand-written lists produced no red at all (issue
#700). `apps/admin/lib/route-registration.test.ts` now names every missing place and route
in a single failure. This file is the same six in prose, for a reader who arrives before
running anything.

## The six places

| Place                                       | What a new route writes there                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/lib/measure.ts`                 | A `MEASURE_BY_ROUTE` row: the width cap this screen's own POC in `plan/admin-shell-poc/` draws, with the POC file and the selector the number was read from.                                                    |
| `apps/admin/lib/save-model.test.ts`         | A `SCREENS` row for the page and one for its `@rail` slot page, each saying how the screen stores what an author does on it.                                                                                    |
| `apps/admin/lib/page-title.test.ts`         | The route in the restated tree list. The page itself needs a `generateMetadata` built through `pageMetadata`, or its browser tab is the layout's one static title.                                              |
| `apps/admin/lib/rail-routes.test.ts`        | A slot page at `apps/admin/app/(shell)/@rail/<route>/page.tsx`, returning `NoRailSection` when the screen carries no rail, and the route named in `CURRENT_SECTION`, in `NO_SECTION` or in the `withRail` list. |
| `apps/admin/e2e/measure.pw.ts`              | The screen in `screens()`, with the cap it takes, in route order.                                                                                                                                               |
| `apps/admin/e2e/rail-screens.pw.ts`         | **The editor's screens of one form only.** The screen in `screens()`, with the rail row it marks and the browser tab it names.                                                                                  |
| `apps/admin/e2e/operations-form-rail.pw.ts` | **One form's operational screens only**, under `/operations/forms/[formId]`. The same row, in that spec's own `screens()`.                                                                                      |

The last two are **one place**, asked of whichever rail the screen sits beside. A screen
about one form is either authoring or operational (Code Owner, 2026-11-02): the editor's rail
nests the form's steps under its own row, and the Operations rail is the four contexts of the
selected environment, so a row in the wrong sweep asserts a rail the screen does not have. A
screen about no form is in neither, which is why the place is asked per route rather than
waived per screen.

`lib/rail-routes.test.ts` holds **three further hand-written arrays** beyond
`CURRENT_SECTION`, `CURRENT_CONTEXT`, `NO_SECTION` and the `withRail` list: the shell's
top-level roots, the editor's screens of one form, and Operations'. A new top-level area
fails on the roots array as well as on `withRail`, and neither failure is one the table above
predicts.

Those two current-row tables answer the same question for the two rails. `CURRENT_SECTION` is
the editor's, whose slot pages say `current={{ kind: "section", section: "links" }}`;
`CURRENT_CONTEXT` is Operations', whose slot pages say `current="links"`. A route in the wrong
one fails on the assertions that read each slot's own source.

**A moved address is not a screen.** `/forms/{formId}/responses`, `/links`, `/webhooks` and
`/export` still arrive, as `redirects()` entries in `apps/admin/next.config.ts` rather than as
redirecting pages. That is the pattern to copy: a page is a route in this tree and costs all
six registrations while producing no document to rail, title or measure.

Some of those rows are worth a sentence each. A route with **no slot page** does not render
an empty rail: on a soft navigation Next keeps the previous screen's, so the rail stands
beside a screen it says nothing about. And all three `screens()` lists are **hand-written**,
which is why the derived gate reads them too: a screen left out of the width walk stops being
measured, a screen left out of its rail sweep has its rail and its title measured by nothing,
and neither absence fails on its own. That is not hypothetical. The rules route (issue #669)
was missing from the rail sweep for two cycles while every gate stayed green.

## The conventions that go with them

- **Every user-facing string comes from the catalog** (`apps/admin/lib/i18n/en.ts`,
  ADR-27), the page name in the tab title and the rail row's label included. A literal in
  a page is a defect rather than a shortcut.
- **A section of a form is four things at once**: a `forms.tab.*` name, a breadcrumb crumb,
  an `<h1>` and a rail row. Adding one also means `FormSection` in
  `apps/admin/lib/page-title.ts`, plus `RAIL_SECTIONS` in
  `apps/admin/lib/forms/subtree-rail.ts` for an authoring section or
  `FORM_OPERATIONAL_CONTEXTS` in `apps/admin/lib/ops/form-contexts.ts` for an operational
  one. The agent screen tables are a pair too: `apps/admin/lib/agent/screens.ts` with its
  chip in `lib/agent/context-chip.ts`, and `apps/api/src/features/agent/screens.ts` with a
  facts schema and a context builder.
- **The screen count is spelled out in prose in several files** and every one of them moves
  when a screen arrives. `grep -rn "twenty-three screens" apps/admin packages/create-qcms-app`
  finds them, whatever the current number is. Issue #882 proposes deriving or deleting
  those counts; until that is decided they are hand-maintained.
- **This app has a twin.** Non-test source under `apps/admin` is generated into
  `packages/create-qcms-app/templates/common/apps/admin`, so a new page means
  `pnpm qcms:sync-templates`; `pnpm check:templates` refuses the drift otherwise.

## One more thing a screen with a NEW dynamic segment needs

The six above are per **screen**. `apps/admin/e2e/reflow.pw.ts` is per **segment**: it
derives the route tree itself, so a new screen is swept without being listed, but a route
whose dynamic segment the sweep has no fixture value for fails loudly rather than being
skipped. A screen at `/thing/[thingId]` therefore adds `"[thingId]"` to that spec's
`fills`. Task 069 met this with `[workspaceId]`; a screen whose segments are all ones
already listed needs nothing.

It is not a seventh place for the same reason the derived gate below is not: it holds no
per-route data. What it holds is one value per **kind** of id, and those are far fewer
than the screens.

`apps/admin/lib/route-registration.test.ts` is not a seventh place. It holds no per-route
data of its own: it reads the route tree from git and asks the six whether they have heard
of each route. Adding one there is never part of adding a screen.
