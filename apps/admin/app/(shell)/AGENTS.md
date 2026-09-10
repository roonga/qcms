# Adding a screen to the admin shell

A route under `apps/admin/app/(shell)` is registered in **five** places. Only one of them
used to announce itself, so a lane that met that one and stopped learned the same rule four
more times, one red per cycle (issue #700). `apps/admin/lib/route-registration.test.ts`
now names every missing place and route in a single failure. This file is the same five in
prose, for a reader who arrives before running anything.

## The five places

| Place                                | What a new route writes there                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/lib/measure.ts`          | A `MEASURE_BY_ROUTE` row: the width cap this screen's own POC in `plan/admin-shell-poc/` draws, with the POC file and the selector the number was read from.                                                    |
| `apps/admin/lib/save-model.test.ts`  | A `SCREENS` row for the page and one for its `@rail` slot page, each saying how the screen stores what an author does on it.                                                                                    |
| `apps/admin/lib/page-title.test.ts`  | The route in the restated tree list. The page itself needs a `generateMetadata` built through `pageMetadata`, or its browser tab is the layout's one static title.                                              |
| `apps/admin/lib/rail-routes.test.ts` | A slot page at `apps/admin/app/(shell)/@rail/<route>/page.tsx`, returning `NoRailSection` when the screen carries no rail, and the route named in `CURRENT_SECTION`, in `NO_SECTION` or in the `withRail` list. |
| `apps/admin/e2e/measure.pw.ts`       | The screen in `screens()`, with the cap it takes, in route order.                                                                                                                                               |

Two of those rows are worth a sentence each. A route with **no slot page** does not render
an empty rail: on a soft navigation Next keeps the previous screen's, so the rail stands
beside a screen it says nothing about. And `screens()` is **hand-written**, which is why
the derived gate asserts it too: a screen left out of it is a screen the browser walk
quietly stops measuring, with no red anywhere.

## The conventions that go with them

- **Every user-facing string comes from the catalog** (`apps/admin/lib/i18n/en.ts`,
  ADR-27), the page name in the tab title and the rail row's label included. A literal in
  a page is a defect rather than a shortcut.
- **A section of a form is four things at once**: a `forms.tab.*` name, a breadcrumb crumb,
  an `<h1>` and a rail row. Adding one also means `FormSection` in
  `apps/admin/lib/page-title.ts`.
- **The screen count is spelled out in prose in several files** and every one of them moves
  when a screen arrives. `grep -rn "eighteen screens" apps/admin packages/create-qcms-app`
  finds them, whatever the current number is. Issue #700 proposes deriving or deleting
  those counts; until that is decided they are hand-maintained.
- **This app has a twin.** Non-test source under `apps/admin` is generated into
  `packages/create-qcms-app/templates/common/apps/admin`, so a new page means
  `pnpm qcms:sync-templates`; `pnpm check:templates` refuses the drift otherwise.

`apps/admin/lib/route-registration.test.ts` is not a sixth place. It holds no per-route
data of its own: it reads the route tree from git and asks the five whether they have heard
of each route. Adding one there is never part of adding a screen.
