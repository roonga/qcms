# HANDOFF: AWAITING-HUMAN Code Owner to rule on the no-JS `__qop` response mechanism, which ADR-43's 200 re-render cannot express in Next App Router

Task 073, branch `feat/073-repeat-rendering`, based on task 072's head
`9c96efd1774e452e7463bad488d281ffc6b3114c`.

Everything that does not depend on the ruling below is built and green. The one thing
that is parked is the **shape of the response to an Add or Remove post on the no-JS
path**, because the mechanism ADR-43 rules cannot be built in this app as it stands and
two of its clauses contradict each other. That is a Code Owner call, not an
implementer's, so it is asked rather than answered.

---

## The two contradictions, stated precisely

### 1. A Next App Router page cannot answer a POST, and a route handler cannot render the page

ADR-43 and `plan/repeating-groups-and-table-input.md` section 4.2 rule that the `__qop`
request **re-renders the step in its own 200 response rather than redirecting**, with
the POST body as the carrier for the typed values. The reasoning is sound and is not in
question: the values are the whole step rather than a refused subset, and the whole step
at nine instances does not fit a 4 KB cookie, so capping the carriage would mean
dropping answers.

What the ruling did not anticipate is that the portal cannot produce that response:

- `apps/portal/app/s/[sessionId]/step/route.ts` is a **Route Handler**. It can return
  any `Response`, and it cannot render the flow page: the page is a Server Component
  tree whose stylesheet and script tags Next injects at render time, so a hand-rendered
  document would come back unstyled and without the framework's assets.
- `apps/portal/app/s/[sessionId]/page.tsx` is a **page**. An App Router page answers
  GET and HEAD; a POST to its path is a 405. A segment may hold a `page.tsx` or a
  `route.ts` and not both, and a route group does not change the URL, so there is no
  arrangement of files that puts a POST handler and the page on one path.
- Next's middleware (`apps/portal/proxy.ts`) can rewrite, but a rewrite does not change
  the method, so the page still refuses the POST.

Three mechanisms could produce a 200 page from that POST. Each has a cost the Code Owner
should weigh, and none of them is what the record currently says:

1. **A Next Server Action on the step form.** This is the framework's own answer and it
   works with scripting disabled (Next renders the form with a hidden action id and
   answers the POST by running the action and re-rendering the page in the same 200).
   Costs: it is a pattern this repository has deliberately not used anywhere (the admin
   README records why); `scripts/check-origin-guards.test.ts` enumerates exactly five
   belted POST handlers and a Server Action is a sixth request entry point with its own
   origin checks rather than SEC-9's belt; and the CSP would have to admit Next's action
   plumbing. It also does **not** solve the carrier on its own: an action's return value
   is not available to a Server Component render, so the typed values still need a
   request-scoped channel (an `AsyncLocalStorage` or a `cache()` store the action writes
   and the page reads, which does work, since both run in one request).
2. **A server-side self-fetch.** The route handler applies the roster operation, fetches
   its own flow page over HTTP with the typed values on a request header, and returns
   that HTML with status 200. It is expressible today and needs no new framework
   feature. Costs: an extra hop per Add or Remove; the values are bounded by Node's
   header limit (16 KB by default rather than the cookie's 4 KB, so four times the
   headroom and still a bound); and `QCMS_PORTAL_BASE_URL` is the public URL, so in the
   Compose topology the self-fetch leaves and re-enters through Caddy, which is fragile
   enough to want a loopback base URL of its own.
3. **Keep the 303 and carry the typed values in the `qcms_step_ctx` cookie, capped, with
   the ruled overflow behaviour.** Expressible today, no new mechanism, and the Continue
   path's cap and overflow sentence already exist to be reused. Cost: it is the carrier
   section 4.2 refused, and at nine `longText` instances it drops values, which is the
   one outcome the design refuses. It would need the refusal reopened deliberately
   rather than quietly.

**Nothing was built for any of the three.** Implementing one of them without a ruling
would be inventing the ruling, which the work order forbids, and the choice reshapes the
step route, the origin-guard gate and possibly the CSP, so it is cheaper asked than
undone.

### 2. A 200 response to a POST cannot carry a URL fragment, so the ruled no-JS focus landing needs the 303 the ruling traded away

ADR-43 and plan section 4.3 rule that after an add, "without scripting the same landing
is reached by a **fragment** on the re-rendered page, which section 4.2 makes a 200
response to the `__qop` POST rather than a redirect".

A fragment is part of the URL, and a 200 response to a POST leaves the browser on the
POST's own URL with whatever fragment that URL had, which is none. Only a redirect can
introduce one (`303 Location: /s/{id}#ins_7k2`). So the two clauses cannot both hold:
either the response is a 200 and the no-JS landing is reached some other way, or it is a
303 with a fragment and the values need a carrier other than the POST body.

Two ways out, for the Code Owner to pick between:

- **Drop the fragment on this path** and accept that a no-JS add lands at the top of the
  re-rendered step. The record already says no source addresses focus after a full-page
  POST, so this is a decision either way rather than a citation.
- **Land by markup instead of by URL**: the new instance's heading is already rendered
  with `tabindex="-1"` and `id="ins_..."`, so it can also carry `autofocus`, which the
  browser honours on a freshly loaded document without scripting. That reaches the same
  destination on a 200, and it is worth confirming rather than assuming because
  `autofocus` on a non-form-control is a less-travelled path.

---

## What is built, green and pushed

- **The compiler** (`packages/a2ui-compiler`). The `RepeatGroup` template node, the
  member controls once with the bare `questionId` as each `name`, the Add and Remove
  lexicon, `COMPILER_VERSION` 0.2.0 to 0.3.0, and golden generation `v4/` with the seven
  existing forms carried across byte-identically plus two appended repeat forms.
  Acceptance case 5 and the compiled half of case 34 are asserted there.
  **`A2UI_SPEC_VERSION` did not move**, which is the `Honeypot` precedent and is reported
  as a third item for the record below.
- **The renderer** (`packages/ui`). `expandRepeatGroups` clones the template per live
  instance in roster order and qualifies each clone's `name`; `documentForVisible` leaves
  a template whole because per-instance visibility can only be resolved once the instance
  is known; the instance card is a `<fieldset>` whose `<legend>` holds the heading that
  carries the focus handle; Add and Remove are `__qop` submit buttons with
  `formnovalidate` without scripting and host callbacks with it; the polite status region
  exists on the scripted path only; the stacked presentation is one input per row.
  Acceptance cases 34 (DOM half), 37 (structural half) and 38 are asserted in
  `packages/ui/src/repeat.test.tsx`.
- **The API and the schema** (`apps/api`, `packages/db`). The roster reaches
  `evaluateRules` and `prepareSubmission`; the step projection carries it beside `values`
  and `flowState`; `visibleQuestions` and `missingRequired` are answer keys; the batch
  answer endpoint is rate limited per entry; the roster endpoint refuses an add past
  `max` and carries the one-time token; migration 0023 adds the nullable `op_token`
  column with its invariant in code; **issue #968's sweep moved inside the session
  lock**.
- **The portal, the parts that do not depend on the ruling.** `__qop` decoding as the
  fourth reserved name, and Continue on the batch endpoint with per-entry refusals and
  the typed values carried on a refused request.

## What remains, once the ruling lands

1. The `__qop` branch of `apps/portal/app/s/[sessionId]/step/route.ts`, in whichever of
   the three shapes is ruled, and the focus landing in whichever of the two.
2. The portal's two step views: the roster and the operation token into
   `native-step.tsx` and `step-flow.tsx`, the scripted Add and Remove with their focus
   destinations and the status sentence, and the instance-naming error summary anchored
   at the qualified field id.
3. The `qcms_step_ctx` cookie's `{error, constraint, value}` record per refused field,
   the cap stated in fields, and the ruled overflow sentence.
4. The browser suite: acceptance cases 27 to 33 and 35, the eighth no-JS spec,
   `docs/portal-constraints.md` updated with its exception list still empty and its
   "cannot be CLEARED without scripting" bullet asserted unchanged, and the axe sweep
   over a rendered group.
5. The API integration tests for cases 36 and 54 to 57, and the #968 interleaving test
   that fails against the pre-change ordering.
6. `docs/features/README.md`'s 073 row, and the remaining changesets.

## A third item for the record, not a blocker

ADR-18's amendment says "`A2UI_SPEC_VERSION` and `COMPILER_VERSION` both move". The first
cannot: `A2UI_SPEC_VERSION` is the installed `@a2ra/core` **package** version and
`packages/a2ui-compiler/src/version.test.ts` asserts it against
`node_modules/@a2ra/core/package.json`, while `RepeatGroup` is deliberately a qcms-owned
node type rather than an `@a2ra/core` registry component, so no vendored schema moved.
Task 026 added the `Honeypot` node type on exactly these terms and moved the compiler
stamp alone. The new golden generation is opened by `COMPILER_VERSION`, which is what the
amendment's purpose needs. Recorded in `packages/a2ui-compiler/src/version.ts` and in
`docs/a2ui-mapping.md` so a reader meets it beside the code rather than in a diff.
