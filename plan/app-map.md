# QCMS app map (agent reference)

A working map of the two web apps for an agent driving them in a browser. Built 2026-10-24 from a walk through the running dev stack and from the Playwright suites. Not a contract: when this disagrees with the code or `plan/admin-design-contracts.md`, they win.

## Topology and addresses

- One API and one database serve two frontends. The admin is a BFF to the API.
- Ports (`docs/PORTS.md`, seat `S` from `QCMS_PORT_SEAT`, default 0):
  - Dev: portal `7S00`, API `7S10`, admin `7S40`.
  - Test harness and Compose E2E: portal `17S00`, API `17S10`, admin `17S40`.
- On seat 0 that is admin `http://localhost:7040`, portal `http://localhost:7000`.
- The admin's draft preview (`/forms/[id]/preview`) renders in-process with the portal's renderer. It does not call the portal.

## Admin shell

- **Top nav** (`components/admin-nav.tsx`) is the app-level navigation: Questions, Forms, Responses, Webhooks, Workspaces, Settings.
- **Topbar right side:**
  - Environment switcher ("Environment: prod"; menu items `test` / `prod`; testid `qcms-environment-switcher`; stored in a cookie). Release, link minting, closing a form, erasure and webhook changes all act on the selected environment.
  - Appearance menu ("Appearance: Dark"; Light / Dark / High contrast).
  - Account menu ("<initials>, account menu for <email>"; contains Sign out).
- **Left rail** is page-scoped, not app navigation. It is rendered through the `@rail` parallel route slot (`app/(shell)/@rail/`). Every route has a slot page; routes without a rail render `no-section.ts`. See "Left rail" below.
- The post-login home is `/questions`.

## Admin routes

### Auth

- `/sign-in` (POSTs to `/sign-in/submit`); `/sign-out` (POST).
- `/change-password` (forced first-run change).
- 2FA: `/two-factor/enroll` (QR code and "Setup key", "Six-digit code", "Verify"), then `/two-factor/recovery-codes` ("I have saved these codes"), then `/two-factor/challenge` and `/two-factor/recovery`.
- There is no self-registration.

### Question library

- `/questions`: list with Search, Status (Draft / Published / Deprecated) and Type filters, plus "Apply". Rows link through "Open question <id>". "New question" goes to `/questions/new`.
- `/questions/new`: Slug, Type (locked once created), Label, Help text, options for choice types ("Add option"), then "Create draft". No rail.
- `/questions/[id]?v=N`: the version editor.
  - The rail holds the "Back to questions" link, the id, Slug / Created / Type, and the lifecycle buttons "New version" and "Publish version N".
  - The rail's version list nests panel rows: Content, Options, Constraints, Validation messages, Yes and no labels, Preview.
  - One heading row (`<id> · Version N`, status tag) carries "Save draft". This editor does **not** autosave.
  - Publishing confirms in an alertdialog ("Publish"). "Deprecate version N" then "Deprecate".

### Forms

- `/forms`: list with Search, Status (Open / Closed) and Sort; rows link through "Open form <slug>". `/forms/new` has Slug, Title and "Create form".
- `/forms/[id]` is the builder ("Form details").
  - Header actions: "Publish", "Publish and release…", "Close in <env>".
  - **Autosaves**, and the first change stores the draft. There is no locking: the last writer wins.
  - Panels include Form title, Rules lens ("Edit rules", "Add rule"), Validation, and Form settings (challenge, minimum time).
  - The Assistant panel sits at the right edge (testid `qcms-assist-input`).
  - Rail: the form-title row (with "Actions for <title>" menu), numbered steps (`#step-<id>` fragments on the builder), "Add step", then section links.
- Section routes under `/forms/[id]/`, in rail order:
  - `rules`: rule table, modal editor, and the "Rule test bench" (read-only evaluation, "Run preview").
  - `preview`: "Preview - not published" banner; same renderer as the portal. Saves nothing.
  - `versions` ("Version history"): published versions and a compare control; `/versions/[n]` shows one.
  - `releases`: "Released now" per environment, "Release a version…", release history. **Publishing does not serve a form; releasing does.** An unreleased form answers 409 or "unavailable" in the portal.
  - `links`: the standing public link (`<portal>/f/<slug>`) and secure links ("Mint links"). Minted URLs are shown once.
  - `responses`: filters (version, submitted from/to in the operator time zone, flagged), "Export", detail at `/responses/[sessionId]`, and erasure ("Erase respondent data…", which needs typed confirmation).
  - `webhooks`: endpoints ("Add endpoint", secret shown once), recent deliveries, and per-endpoint Change URL / Rotate secret / Deactivate.
- Also under `/forms/[id]/`: `export` (CSV route) and `assist` (agent SSE route).

### Operations and membership

- `/responses`: an index of per-form links plus the "Erasure log" (`/responses/erasures`). No browsing here.
- `/webhooks`: the global dead-letter queue ("Redeliver all") and per-form "Configure webhooks for <slug>".
- `/workspaces`: workspace list and "Your own access" (grants such as `all.forms.editor - forms.editor - all - all`).
- `/workspaces/[workspaceId]`: Members, Access groups ("Create an access group"), and the two-person switch "Require a second approver for production". On the dev stack the id is opaque, so take it from the list link (the e2e seed uses `org_default_workspace`, which does not exist here).
- `/settings`: Account, Change password, Two-factor authentication. These are three panels on one route, chosen from the rail.

## Portal (respondent) routes

- `/f/[slug]`: anonymous entry, "You are invited to complete this form" and "Start". Start POSTs to `/f/[slug]/start` and 303-redirects to `/s/ses_…` with a `qcms_session` cookie. **Pressing Start creates a real session.**
- `/l/[token]`: secure link. It goes to `/s/…` when valid, otherwise to `/link-error` (expired, used, revoked, closed form, invalid).
- `/s/[sessionId]`: the step flow. Testids: `primary-action` (Continue / Submit), `back-action`, `progress` ("Step 2 of 3"), `step-card`, `flow-failure`.
- `/done` (heading "Thank you, your responses were received", plus `content-hash`) and `/expired`.
- Test environment addresses: `/test/l/<token>` and `/test/s/…`. There is no `/test/f/<slug>`.
- Header: brand mark and "Appearance" (mode, font, density; stored in a cookie).

## End-to-end lifecycle (order an operator follows)

1. Create the question, then publish it (questions must be published before a form can pin them).
2. Create the form; "Add step"; "Add question from library" (pin a version).
3. Add rules on `/rules`. The modal buffers until "Save".
4. Preview.
5. Publish (the freeze summary dialog, "Publish vN").
6. Release to an environment.
7. Mint links, or use the public link.
8. The respondent fills it in.
9. Read responses: export, erase, flag.
10. Webhooks deliver `response.submitted`; a flagged response's event is withheld until an operator releases it.

The specs for each step are listed in `apps/admin/e2e/` and `apps/portal/e2e/`. The full stack runs in `apps/e2e/full-stack-conditional-form.pw.ts`.

## Seed data seen on the dev stack (2026-10-24)

- User `dev@qcms.test`. Holds the installation-wide claim plus `forms.editor` and `forms.approver` in the default workspace, for environments test and prod. Response read and export are **FORBIDDEN** for this account (the responses screen says so).
- 7 questions (`q_accident_count`, `q_at_fault_accident`, `q_coverage_level`, `q_dob`, `q_full_name`, `q_medical_history`, `q_preexisting_conditions`).
- One form, `frm_sample_library` (slug `sample-library`): v1 published, released nowhere, no links or endpoints.
- Credentials: never copy them into files. Dev stack: `scripts/dev-compose.mjs` (prints them once). Test suites: `apps/admin/e2e/support/admin-account.ts` and `apps/api/e2e/support/admin-accounts.ts`.

## Driving the UI safely

- **The environment switcher defaults to prod.** Navigation and opening menus are safe. Typing in the form builder autosaves. Publish, release, mint, close, erase and webhook changes are real.
- Wait for hydration before pressing React Aria controls (`apps/admin/e2e/support/hydration.ts`); presses before it are lost.
- React Aria checkboxes and radios hide their inputs, so click the label text. Required labels carry an `aria-hidden` "*", so match names with `exact: true`.
- **Builder autosave pauses** while a step is empty or a rule has no target.
- **Two-person rule** (off by default): with it on, prod webhook changes and releases wait for a second account to confirm.
- Breakpoints: `--bp-compact` 40rem and `--bp-sidebar` 64rem. Below 64rem the rail collapses into a disclosure.
- Admin pages refuse framing, so a probe cannot load them in an iframe. Navigate the tab instead.

## Left rail (as built, 2026-10-24)

| Screen                                                                              | Rail | Component / class                                                | Items are                                                           |
| ----------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/questions`, `/questions/new`                                                      | none | `no-section`                                                     | -                                                                   |
| `/questions/[id]`                                                                   | yes  | `div.qcms-rail.qcms-question-rail`                               | back link, details, lifecycle buttons, version links, panel buttons |
| `/forms`, `/forms/new`                                                              | none | `no-section`                                                     | -                                                                   |
| `/forms/[id]` and its 8 sections                                                    | yes  | `nav.qcms-rail.qcms-rail--form` (`form-subtree-rail.tsx`)        | title row with menu, step links, "Add step", section links          |
| `/responses`, `/responses/erasures`, `/webhooks`, `/workspaces`, `/workspaces/[id]` | none | `no-section`                                                     | -                                                                   |
| `/settings`                                                                         | yes  | `nav.qcms-rail.qcms-settings-rail` (`settings-section-rail.tsx`) | panel buttons                                                       |

Contract: `plan/admin-design-contracts.md` §7 (form subtree, plus the question-rail amendments) and §7a (Settings as a written exception). The shared chrome is `components/rail-frame.tsx` and `rail-disclosure.tsx`. The CSS is in `app/globals.css`, near the `.qcms-rail__summary` rules.
