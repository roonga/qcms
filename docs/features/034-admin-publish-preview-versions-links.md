# 034 - Admin publish, preview, version history, secure links

**Stage:** 8a · **App:** `apps/admin` · **Depends on:** 033, 024 (links API), 028 (renderer)
**References:** ADR-01, **ADR-18, ADR-19** · `ARCHITECTURE.md` §6 (preview fidelity) · **Wireframe:** `docs/wireframes/admin-publish-preview.md` (042) · task 058 (its theme island mounts on the preview seam this task builds; 058 runs after this task per the Code Owner's 2026-08-01 flow-first aim)

## Amendment (2026-08-02, task 034; staleness rule)

The **Live preview** deliverable below says the preview runs "core evaluator client-side".
That is not implementable and the identical tension has already been ruled on once: rule 1
of `apps/admin/lib/server/r2-import-surface.test.ts` bans `@roonga/qcms-core` value imports in the
admin outright, and 033's amendment (2026-08-01, PO seat) resolved it by keeping the kernel
in the API, where it already lives. The portal is no different: it performs **no** rule
evaluation either (R2), it receives an authoritative `visibleQuestions` list and projects
the compiled document onto it.

So `POST /admin/forms/:id/draft/preview` returns both halves of that pair - 011's compiled
documents *and* the forward pass's visible set for the answers sent with the request - and
the preview pane projects with `documentForVisible` and renders with `A2UIStepRenderer`.
`documentForVisible` moved from `apps/portal/lib/visible.ts` into `@roonga/qcms-ui` in this change,
so preview and serving share one projection as well as one renderer. Preview fidelity is
strengthened rather than weakened by the correction: the admin is not a second
implementation of visibility, it is the same one, which is what exit criterion 3's
deep-match then proves.

Two smaller corrections from the same landing, both recorded in the wireframe:

- The mint dialog's one-time control is a vendored **`Checkbox`**, not the `switch` the
  wireframe names: the a2-react-aria set has no Switch and hand-writing one is what ADR-22
  forbids. Adding one is a `COMPONENT_GUIDELINES` vendoring in its own right.
- Link **expiry is chosen as a day** and widened to the end of that day before it reaches
  024's route, which wants an instant.

## Context

The moments of truth in the authoring loop: publish (kernel errors verbatim), preview (identical renderer, identical documents), history (immutability made visible), and secure-link distribution (the gap-fix landing its UI).

## Deliverables

- **Publish flow:** publish button on a form's draft → confirmation summarizing what freezes (pins, rule count, steps) → on failure, the full `PublishError[]` rendered as an actionable list - each error links/scrolls to the offending rule/step/question in the builder (the structured `path` from 004 makes this mechanical) → on success, version badge + link to history.
- **Live preview:** renders the draft through a dry-run compile (a `POST /admin/forms/:id/draft/preview` endpoint returning 011's compiled output for the *draft* - add it to 022's slice as a thin addition) into the **shared renderer** with an interactive answer state and live rule evaluation (core evaluator client-side), so authors walk their own branches before publishing. Banner: "Preview - not published". Preview must be the same `@roonga/qcms-ui` component the portal uses (import-surface test - preview fidelity is the feature, ADR-08/§6).
- **Preview container is a styling seam:** the preview renders inside a single container element that is its styling boundary, and no code assumes the preview shares the admin's theme context. Build the boundary, not the switcher - task 058 mounts its theme island on it. This is a structural constraint only: no theme selection, no mode switching, and no portal-theme defaulting in this task.
- **Version history:** list of published versions (version, publishedAt, compilerVersion/a2uiSpecVersion/semanticsVersion stamps); view any version read-only through the renderer using its **stored** compiled documents (ADR-18 - history shows the audit copy, proving what respondents saw); side-by-side definition diff between versions (JSON diff, readable).
- **Secure links UI** (on a form with ≥1 published version): mint (expiry, one-time, batch count), list with state (active/consumed/expired/revoked), copy URL, revoke with confirmation; batch export of minted URLs as CSV.
- Close/reopen form actions with in-flight-session explanation (R1 taught in UI copy).
- Playwright: publish the insurance form (built in 033's test), walk the preview branches, view v1 history, mint + revoke a link.

## Exit criteria

1. Playwright publish→preview→history→links suite green.
2. Publish-error UX: a seeded broken draft's errors each navigate to their target.
3. Preview fidelity: preview DOM for a step deep-matches the portal's rendering of the same published document (shared-renderer assertion, not screenshot).
4. History view uses stored compiled JSONB (network assertion: no draft-preview call on history pages).
5. axe pass on publish, preview, history, links screens.

## Out of scope

Response browsing (035), webhook UI (035), pin cascade/impact analysis (R7), preview-as-respondent shareable links (issue), preview theme/mode switching and portal-theme defaulting (058 - build the container boundary only).
