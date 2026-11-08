# Agent builder: rulings and work plan

Status: Code Owner rulings recorded 2026-11-08. Nothing built. Source: the "QCMS Agent Builder" Design canvas and an independent review against `origin/main` (ff3952e7).

## Rulings

Q13 (entry and exit) approved 2026-11-08; text to be added from the Code Owner's checkout.

| #   | Question                                 | Ruling                                                                                                                                                                                                               | Decision records to change                                                             |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Q1  | Is the agent the only authoring surface? | No. Existing builder screens stay reachable as "Edit by hand". The agent-first shell is the default when the agent flag is on.                                                                                       | `docs/adr/admin.md` (note under ADR-19, ADR-25)                                        |
| Q2  | May draft edits apply without Confirm?   | Yes, as a draft-scoped edit class: applied through the single draft save path, one `control.agent_actions` row per edit, Undo offered. Publish, library publish, links, webhooks, erase and membership keep Confirm. | `docs/agent-principle.md` point 2, ADR-25, SEC-17                                      |
| Q3  | Preview mechanism                        | Inline ADR-38 island with container-query breakpoints. No iframe.                                                                                                                                                    | none                                                                                   |
| Q4  | Where appearance lives                   | Nullable `appearance` jsonb on `form_drafts` and `form_versions`, outside `FormDefinition`. Frozen at publish. Deployment env stays the default.                                                                     | ADR-30, supersedes the per-form exclusion in `docs/features/049-admin-theme-editor.md` |
| Q5  | High contrast for derived themes         | Every theme ships its own high-contrast palettes (not a single shared layer). Differs from the review recommendation.                                                                                                | ADR-30, `docs/theming.md`, `packages/ui/src/theme-tokens.test.ts`                      |
| Q6  | Respondent controls                      | Display mode, high contrast, text size, and a legibility face override (System, Atkinson Hyperlegible, OpenDyslexic, Lexend). Density is admin-only. `POST /appearance` stays for no-JS.                             | ADR-30, `docs/portal-constraints.md`                                                   |
| Q7  | Website fetch for theme derive           | Accepted under a new SEC-18: DNS resolve and pin, private ranges refused, https only, no redirects, size and time caps, no page text to the model, raster logo only, PDF deferred, rate limit, audit row.            | `docs/SECURITY_DESIGN.md` (SEC-18)                                                     |
| Q8  | Portal rail                              | Names every step; rule-hidden steps show "Not needed". Back-jump to completed steps through the existing cursor; forward refused.                                                                                    | ADR-28                                                                                 |
| Q9  | Text size compounding                    | Admin base 16 to 24 px multiplied by respondent scale 100, 125, 150, 200 percent; product capped at 32 px; reflow proven at 320 px.                                                                                  | `docs/theming.md`                                                                      |
| Q10 | Workspace appearance lock                | In scope now. Differs from the review recommendation.                                                                                                                                                                | ADR-41 scope, SEC-3 policy rows, SEC-15 audit                                          |
| Q11 | Faces outside the registry               | Derived faces map to the registry or System. New fonts are separate registry PRs. Boards to use registry faces.                                                                                                      | none                                                                                   |
| Q12 | Top-bar Publish and Share preview        | Publish opens the existing wizard. Share preview opens the authenticated admin preview route. No public preview links.                                                                                               | none                                                                                   |

## Review findings carried into the plan

- Logo storage does not exist. Raster only (PNG, JPEG, WebP), magic-number sniffed, size cap, stored on the workspace theme row, SVG refused.
- Serve-step progress is only `{stepIndex, totalVisibleSteps}` (`apps/api/src/features/responses/serve-step/schema.ts`). The rail needs an ordered `steps` list.
- Measure layout in the admin browser and send it as a strict-schema fact. No `layout-report` API route.
- Put `data-qcms-question-id` on the qcms-owned wrapper in `packages/ui/src/form-field.tsx`, never on vendored files (ADR-22).
- Appearance goes inside the draft PUT body, not a second write route: one revision counter, one agent-assisted mark.
- Undo reverses the draft op only. Unpublished library versions stay until deprecated.
- "Tint the page background" changes every text-on-page pair. Include it in the contrast check or drop it.
- The builder shell needs a recorded exception to the one-rail rule in `plan/admin-design-contracts.md` section 7 and to the ruled panel widths in `apps/admin/lib/agent/panel.ts`.
- Respondents mid-session keep the version they started (ADR-07). Do not tell admins changes apply on next load.
- Use one word for rule-hidden steps: "Not needed".
- All new strings go in `apps/admin/lib/i18n/en.ts` and `apps/portal/lib/i18n/en.ts` (ADR-27).
- Mirror design rulings into the QCMS design system artifact in the same change.

## Work plan

Size: S under a day, M two to three days, L a week or more. Tier: F Fable, O Opus, S Sonnet.

| ID  | Task                                                                                                                                                                  | Deps       | Size | Tier            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- | --------------- |
| W1  | Decision bundle: ADR-19/25/28/30/41 notes, SEC-3/9 check, SEC-17 and agent-principle amendment, new SEC-18, supersede 049 exclusion, panel-width and rail exception   | none       | M    | F               |
| A1  | Shared pure appearance module: Zod schema, WCAG contrast (4.5, 3, 7), derive light, dark and full high-contrast palettes, correction report; update token test per Q5 | W1         | M    | O               |
| D1  | `appearance` jsonb on drafts and versions; publish copies it; append-only tests                                                                                       | W1, A1     | M    | O               |
| D2  | `control.workspace_themes` (tokens, face, corners, logo, source host) plus workspace appearance lock column                                                           | W1, A1     | M    | S               |
| A2  | Draft PUT accepts `appearance` and validates contrast; start-session and serve-step return the pinned version's appearance; OpenAPI                                   | D1         | M    | O               |
| A3  | Workspace themes CRUD, appearance lock, SEC-3 rows, SEC-15 audit, logo route                                                                                          | D2         | M    | S               |
| A4  | Theme derive route with hardened `BrandFetcher` port (SEC-18)                                                                                                         | A1, A3, W1 | L    | O, Fable review |
| A5  | Serve-step `steps` list, current-step question labels, progress mode, cursor back-jump                                                                                | D1         | M    | O               |
| A6  | Draft edit ops and Undo through the single draft save path, per-edit audit row                                                                                        | W1         | L    | O               |
| G1  | Agent facts: preview selection and layout report, strict schemas, sentinel tests                                                                                      | none       | S    | S               |
| G2  | Action kinds `form.appearance`, `theme.derive` (Confirm), `theme.save`; cards and consequence bands                                                                   | A2, A3, A4 | M    | O               |
| G3  | Builder edit tools (question, step, rule, copy) as draft-scoped edits                                                                                                 | A6         | L    | O               |
| G4  | System prompt and fake-model scripts for the new surface                                                                                                              | G2, G3     | M    | S               |
| U1  | Builder shell route: agent pane, preview, top bar; "Edit by hand" link                                                                                                | W1         | L    | O               |
| U2  | Preview pane: devices, WxH, rotate, zoom, polarity and high contrast, Reset answers, layout collector                                                                 | U1         | L    | O               |
| U3  | Inspect mode and selection fact                                                                                                                                       | U2, G1     | M    | O               |
| U4  | Appearance drawer with pure `lib/forms/text-size.ts` rule module (Custom is a state) and locked state                                                                 | A2, A1     | L    | O               |
| U5  | Derive flow: URL input, Confirm card, "Not saved" row, save as workspace theme, correction messaging                                                                  | A4, U4, G2 | M    | O               |
| U6  | Workspace themes and appearance lock on workspace settings                                                                                                            | A3         | S    | S               |
| P1  | Per-form appearance on a page-level carrier; deployment env as default; brand per form; CSP check                                                                     | A2         | L    | O               |
| P2  | Progress modes: side rail, top indicator, none; no-JS links; narrow fold                                                                                              | A5         | L    | O               |
| P3  | Respondent menu with legibility face; keep `POST /appearance`                                                                                                         | P1         | M    | O               |
| P4  | Text-size scale: root multiplier, cap 32 px, reflow at 320 px                                                                                                         | P3         | M    | O               |
| S1  | Design system artifact: TextSize card, Appearance drawer, preview toolbar, rail states                                                                                | W1         | S    | S               |
| S2  | Docs: `docs/theming.md`, `docs/operations.md`, `docs/deploy-enterprise.md`, `apps/portal/README.md`, `docs/agent-authoring.md`, create-qcms-app templates             | W1, A1     | S    | S               |
| X1  | Vitest with each task: contrast and derivation, fetcher with fake resolver, text-size rule, rail state derivation                                                     | with tasks | n/a  | O, S            |
| X2  | Playwright portal: rail at 1024 and 390, no-JS, respondent menu, reflow at 320, axe in light, dark and high contrast, appearance frozen across publish                | P1 to P4   | M    | O               |
| X3  | Playwright admin: shell, device switch, inspect, drawer to publish to portal, derive against a local fixture server                                                   | U1 to U5   | L    | O               |
| X4  | SEC-17 sentinel and vocabulary tests over new facts and tools                                                                                                         | G1 to G4   | M    | S               |

The old builder screens are not retired (Q1), so there is no retirement task.

### Order

1. W1 alone.
2. In parallel: A1, D1, D2, G1, U1, the text-size module, S1.
3. In parallel: A2, A3, A5, A6; A4 once A1 lands.
4. In parallel: U2, U4, P1, P2, then P3 and P4.
5. In parallel: G2, G3, U3, U5, U6; then G4, X2, X3, X4.

### Gates

- `pnpm verify` on every task.
- `QCMS_PORT_SEAT=<n> pnpm verify:browser:detached` for admin, portal and `@roonga/qcms-ui` tasks.
- `pnpm exec turbo run test --force` for D1, D2 and A2 to A5.

## Consequences of the two non-default rulings

- Q5: A1 must produce a full high-contrast palette per theme at 7:1, the shipped palettes need high-contrast sets, and the token test that limits `.hc` to four accent tokens changes.
- Q10: D2, A3 and U6 gain a lock setting. The drawer shows the locked state and its reason, and the agent must refuse appearance edits on a locked workspace.
