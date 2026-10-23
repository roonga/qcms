# Left rail: one pattern on every screen (ruled 2026-10-24)

**Status:** Ruled 2026-10-24 (Code Owner): all eight decisions accepted, and New form gets a rail. The normative record is `plan/admin-design-contracts.md` §7.0; this file is the analysis behind it. Work: #1115-#1119.

**Premise (Code Owner, 2026-10-24):**

- The top nav is the app-level navigation. The left rail belongs to the page: it holds what the current screen needs beside its content.
- **Every screen has a rail by default.** A screen goes without one only by a case-by-case decision, recorded in the table below.
- A list's filters live in the rail.
- The rail looks and behaves the same everywhere.

## What is there today

Measured in the running admin at 1361px wide, Dark mode, as `dev@qcms.test`.

| Screen                                                         | Rail? | Root element           | Header                                                                              | Items                                                                                          | Current-row mark                         |
| -------------------------------------------------------------- | ----- | ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Questions list, New question                                   | no    | -                      | -                                                                                   | -                                                                                              | -                                        |
| Question detail                                                | yes   | `div` (not a landmark) | "Back to questions" link, the id as a **visible** summary, a Slug/Created/Type list | version **links** with panel **buttons** nested; "New version" and "Publish version N" buttons | fill + bold; **two** rows marked at once |
| Forms list, New form                                           | no    | -                      | -                                                                                   | -                                                                                              | -                                        |
| Form builder and its 8 sections                                | yes   | `nav`                  | summary **hidden**; first row is the form title with a ⋮ menu                       | step **links**, "Add step", section **links**                                                  | fill + bold                              |
| Responses, Erasure log, Webhooks, Workspaces, Workspace detail | no    | -                      | -                                                                                   | -                                                                                              | -                                        |
| Settings                                                       | yes   | `nav`                  | "Settings" as a **visible** summary                                                 | panel **buttons**                                                                              | fill + bold + **2px accent edge**        |

Five of the eighteen screens have a rail, built by three components that disagree on:

- **Header:** three different openings.
- **Way back:** a rail back link, a content breadcrumb, or an "All workspaces" link.
- **Current-row mark:** three styles; the question rail also highlights a parent and child at once.
- **Element type:** links and buttons mixed, although §7 requires anchors.
- **Lifecycle actions:** sometimes in the rail ("Publish version 2"), sometimes in the heading row (the form's "Publish").
- **Landmark:** the question rail's root is a `div`, not a `nav`.

The content column's left edge also moves between 0 and 240px as screens switch between having and not having a rail.

## The rail anatomy

One frame (`components/rail-frame.tsx`) with up to five parts, always in this order. A screen fills only the parts it has, but the order never changes, so the same kind of thing is always in the same place.

1. **Header** (every rail)
   - A back link to the parent screen ("← Forms", "← Questions", "← Workspaces"). Top-level screens have no parent and no back link.
   - The screen's subject: "Questions", "Forms", a form's title, a question's id in mono, a workspace's name. One status tag at most.
   - Below `--bp-sidebar` the header is the disclosure summary for the whole rail. It is one element at both widths, as the §7 amendment of 2026-08-22 requires.
   - It replaces the content breadcrumb, so where you are and how to get back are answered in one place.
2. **Sections:** links to the parts of the subject.
   - Routes where it has routes (a form's Rules, Preview, …).
   - `#fragment` anchors where it has panels on one route (Settings, a workspace, a question's panels).
   - Always `<a>`, never `<button>`, inside a `<nav aria-label="<subject> sections">`.
3. **Children,** nested under the current section only: steps under the builder row, panels under the selected version.
4. **Filters:** the screen's list filters, in a `<form role="search">` with a "Filters" heading and an active-count ("Filters · 2").
   - Same field order on every list: Search first, then the status filter, then type or other filters, then sort.
   - "Apply" submits the filter form. The admin requires JavaScript, so this is not a no-JS path.
   - "Clear filters" appears only when one is set. The URL keeps carrying the filter state, so a filtered list can still be bookmarked.
5. **Actions:** structural actions only, at the foot: "New question", "New form", "Add step", "New version".
   - Lifecycle actions (Publish, Release, Close, Deprecate, Save, Erase) stay in the content heading row on every screen.
   - The rail never holds a destructive or irreversible action.

Shared rules:

- **Root and labelling:** the root is `<aside aria-label="<subject>">` (a complementary landmark), because a rail can now hold filters, not only navigation. The Sections part keeps its own `<nav>`.
- **Current-row mark:** one style everywhere. Tinted fill, weight 700 and a 2px inline-start accent edge; the edge is the non-colour signal that survives High contrast. A parent of the current row gets weight 600 and no fill, so only one row ever reads as selected.
- **Size and position:** 240px wide, under the topbar, sticky, viewport height, scrolling on its own. The rail's background runs to the bottom of the window even when its contents are short, so every screen has the same two-column frame and the content edge stops moving.
- **Narrow screens:** below `--bp-sidebar` the whole rail is one disclosure, shut by default. Its summary names the subject plus the active filter count ("Forms · 2 filters").

## Every screen's rail

Default: every screen has one. The **Exception?** column is where a case-by-case "no rail" would be recorded; none is proposed.

| Screen                          | Header                             | Sections                                                                                           | Filters                                                                                                                                 | Actions      | Exception?              |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------- |
| Questions (list)                | Questions                          | -                                                                                                  | Search, Status, Type                                                                                                                    | New question | no                      |
| New question                    | ← Questions · New question         | Content, Constraints (and Options for choice types) as anchors                                     | -                                                                                                                                       | -            | no                      |
| Question detail                 | ← Questions · `q_id` · status      | versions, with that version's panels nested                                                        | -                                                                                                                                       | New version  | no                      |
| Forms (list)                    | Forms                              | -                                                                                                  | Search, Status, Sort                                                                                                                    | New form     | no                      |
| New form                        | ← Forms · New form                 | -                                                                                                  | -                                                                                                                                       | -            | none (ruled 2026-10-24) |
| Form builder and its 8 sections | ← Forms · form title · status      | Form details (steps nested), Rules, Preview, Version history, Releases, Links, Responses, Webhooks | the current section's own filters: Responses (version, submitted from/to, flagged); Version history (every version / released anywhere) | Add step     | no                      |
| Response detail                 | the form's rail, Responses current | (as above)                                                                                         | -                                                                                                                                       | -            | no                      |
| Responses (index)               | Responses                          | Erasure log                                                                                        | Search forms                                                                                                                            | -            | no                      |
| Erasure log                     | ← Responses · Erasure log          | -                                                                                                  | form, date range (when the log has filters)                                                                                             | -            | no                      |
| Webhooks (operations)           | Webhooks                           | Dead-letter queue, then one link per form ("Configure webhooks for …")                             | form                                                                                                                                    | -            | no                      |
| Workspaces (list)               | Workspaces                         | the workspace list, then Your own access                                                           | -                                                                                                                                       | -            | no                      |
| Workspace detail                | ← Workspaces · workspace name      | Members, Access groups, Workspace settings, Access audit                                           | -                                                                                                                                       | -            | no                      |
| Settings                        | Settings                           | Account, Change password, Two-factor authentication                                                | -                                                                                                                                       | -            | no                      |

The form subtree is the one place where both Sections and Filters appear. On the Responses section the rail shows the form's sections first, then the response filters below them. Moving between a form's sections keeps the same rail and only swaps the Filters part.

## Should the rail go to the top?

**Recommendation: no. Keep it under the topbar.**

- The topbar is the app nav. A full-height rail would take the window's left edge and the wordmark's corner, which reads as app navigation - the opposite of the premise.
- With a rail on every screen, the topbar and rail form a fixed L-shaped frame, and only the rail's contents change between screens. A full-height rail adds nothing to that, and it puts the wordmark inside a page-specific column.

## Should it collapse?

**Recommendation: yes, by hiding it, not by shrinking it to icons.**

- Below 64rem it is already a shut disclosure. Keep that.
- Above 64rem, add a "Hide sidebar" toggle in the rail header, and a "Show sidebar" button in the content heading row while it is hidden. Remember the choice per operator, as Appearance is.
  - The rail is text and filters, with no icon set, so an icon strip would mean inventing icons for steps, panels and filters.
  - When it is hidden and filters are active, the "Show sidebar" button carries the filter count, so a filtered list never looks unfiltered.
- The case that needs it most is the form builder with the Assistant open. At 1361px, 240 (rail) + content + 352 (Assistant) leaves about 770px for editing.
- Optional, as its own ruling: hide the rail automatically while the Assistant is expanded on windows narrower than about 1440px.

## Smaller fix found on the way

- The builder's first-visit autosave notice and the "Not saved yet" help toggle push the content down on every form screen. Consider moving the notice into the save-state popover.

## Decisions needed

1. **Rail by default:** every screen has a rail; "no rail" is a per-screen ruling recorded in the table above. This replaces §7a and the "eight screens get no rail" reasoning in §7.
2. **Anatomy:** the five-part anatomy (Header, Sections, Children, Filters, Actions), one current-row mark, and an `aside` root with a `nav` inside.
3. **Back link:** the header's back link replaces the content breadcrumb.
4. **Filters:** list and section filters move from the content column into the rail.
5. **Lifecycle actions** live in the heading row only. This reverses the question rail's lifecycle block of 2026-09-27; "New version" stays in the rail as a structural action.
6. **New form:** rail or no-rail exception (ruled: rail).
7. **Position:** the rail stays under the topbar.
8. **Collapse:** a "Hide sidebar" toggle above 64rem, remembered per operator. Optionally, auto-hide while the Assistant is open.

## Build notes, once ruled

- `components/rail-frame.tsx` becomes the single frame with the five slots. The three existing rails supply contents only.
  - Each `app/(shell)/@rail/**` page that now returns `no-section` gets a real rail page.
  - `no-section.ts` stays for any ruled exception.
- Filters move out of the list screens, the form Responses screen and Version history.
  - The filter state already lives in the URL, so the rail slot page can read `searchParams` directly.
  - The `@rail` slot re-renders on navigation, which is what keeps the filters and the list in step.
- `app/globals.css`: one summary rule and one current-row rule. Remove the form-only summary-hiding rule and the Settings-only edge rule.
- Tests that pin today's behaviour, to be updated in the same PR:
  - `apps/admin/e2e/rail-screens.pw.ts`, `questions-rail.pw.ts`, `breakpoints.pw.ts`, `reflow.pw.ts`.
  - The filter specs (`responses-filter-validation.pw.ts`, the list filter specs).
  - `components/settings-section-rail.test.tsx`.
- `verify:browser` applies, because it changes `apps/admin`.
- Size: three or four PRs rather than one.
  1. The frame and anatomy.
  2. Rails on the list and operations screens, with filters.
  3. The form subtree's section filters.
  4. Collapse.
