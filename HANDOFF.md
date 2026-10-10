# HANDOFF: AWAITING-HUMAN rule on issue #1035 after the premise it was written on measured false

Branch `fix/1035-stale-action-page`, from `origin/main` at `ca9853b1`. **No page was built and no
record was amended**, deliberately: the feasibility pass the work order asked for first found that
the behaviour #1035 exists to soften does not happen on an ordinary deploy at next 16.4.0, and
every mechanism that would soften the case that remains trips one of the work order's own
hand-back conditions. Both halves of that need a Code Owner ruling before any code lands.

Nothing here is a decision taken. The measurements are reproducible and the recommendation is a
recommendation.

## 1. The measurement that changes the question

Every record in this repository that touches this case says Next recalculates Server Action ids
between builds, so any page held across any deploy posts an id the new build does not know. It is
in ADR-43's amendment (`docs/adr/portal.md`), Q28's consequence
(`plan/repeating-groups-and-table-input.md`), the 073 work order
(`docs/features/073-repeat-rendering.md`), `apps/portal/app/s/[sessionId]/error.tsx`, the #504
runbook in `docs/operations.md`, and the case comments in
`apps/e2e/full-stack-conditional-form.pw.ts`.

**At next 16.4.0 that is false.** Measured on this worktree against production
`output: "standalone"` builds of this portal, served the way `docker/portal.Dockerfile` serves
them (`node apps/portal/server.js`), with a temporary probe page carrying a `useActionState`
Server Action of the same shape as the step form's:

| What changed between two builds                                                                                    | `BUILD_ID` | the action's id | a POST captured from the old build, replayed against the new one |
| ------------------------------------------------------------------------------------------------------------------ | ---------- | --------------- | ---------------------------------------------------------------- |
| nothing (same source, built twice)                                                                                 | changed    | **unchanged**   | **`200`, the action ran**                                        |
| the action's own implementation, the client component that renders it, plus a new unrelated action added elsewhere | changed    | **unchanged**   | **`200`, the action ran, with the new implementation**           |
| the action's **export name**                                                                                       | changed    | **changed**     | not replayed; a changed id is the `409` case below               |

The id is content-addressed, not build-salted: `SERVER_REFERENCE_ID_LENGTH` is 42 and
`extractInfoFromServerReferenceId` reads an info byte holding the used-argument mask followed by a
hash of the action's identity (`next/dist/shared/lib/server-reference-info.js`). The
per-build `encryptionKey` in `server-reference-manifest.json` was identical across the builds as
well.

So the deployment-skew window for the no-JS roster operation is **not every deploy**. It is the
deploys that change `rosterOperation`'s identity: its module path
(`apps/portal/app/s/[sessionId]/roster-action.ts`), its export name, or its used-argument mask. An
ordinary deploy that changes what the action does, what the step renders, or what else the portal
contains leaves a held page working.

**What has not changed** is what happens when the id really is unknown. Re-measured here, on the
same production standalone build, and matching ADR-43's amendment exactly:

- a well-formed unknown id (42 hex) answers `409`, `content-type: text/plain`, body
  `Server Action unavailable.`, header `x-nextjs-action-not-found: 1`;
- a malformed id (44 hex) answers `400`, `Invalid Server Action request.`, same header;
- a real id answers `200` with `text/html` and no such header;
- the framework's own wording (`Failed to find Server Action "..."`, `Invalid Server Actions
request.`) goes to the server log only.

## 2. Feasibility, option by option

### (a) something in-app that sees the outcome: **no Next hook exists at 16.4.0**

- `proxy.ts` runs **before** the route and has no response-side return path. Confirmed by probe
  rather than assumed: a temporary log line in `proxy()` printed
  `POST /zzprobe1035?b=stampA ct=multipart/form-data; ...` for each of the three cases above, and
  the portal's own CSP, `Referrer-Policy` and `x-request-id` are on all three responses, so the
  proxy ran and could not alter any of them.
- The only instrumentation hook is `onRequestError`
  (`next/dist/server/instrumentation/types.d.ts`), which returns `void | Promise<void>` and so
  cannot change a response. It is not even invoked here: `handleUnrecognizedAction` in
  `next/dist/server/app-render/action-handler.js` `console.warn`s and returns
  `RenderResult.fromStatic(...)` with `res.statusCode` already set. Nothing throws.
- `serverActions` config carries `bodySizeLimit` and `allowedOrigins` and nothing else
  (`next/dist/server/config-shared.d.ts`). There is no unrecognized-action hook, and
  `experimental.useSkewCookie` / `deploymentId` are Vercel skew protection, not a self-hosted
  interception point.
- Next's own comment at that call site states the intent: the blank body plus the header mean
  "unrecognized actions can also be handled at the infra level (i.e. without needing to invoke a
  lambda)". The framework is pointing at option (c).

### (a') the custom server wrapper the work order names: possible, and ADR-level

`next.js` and `next-server.js` **are** traced into the standalone tree
(`apps/portal/.next/standalone/apps/portal/node_modules/next/dist/server/`), so `next()` plus
`getRequestHandler()` in our own `http.createServer` would work, and `startServer` also exports an
undocumented `getRequestHandlers`. The cost is why this is not a free (a):

- it replaces Next's documented minimal standalone server with a hand-rolled one, against the
  standing preference recorded in `apps/portal/next.config.ts` ("the vendor's documented setup
  path over a hand-rolled equivalent"), and Next documents that a custom server gives up some
  built-in optimizations;
- the 409 is set late (`res.statusCode` plus `setHeader`, then a static body), so catching it means
  wrapping `writeHead`, `write` and `end` on **every** portal response to swap a status and
  suppress a body already queued;
- it moves the deployment contract in three places that must stay in step: `docker/portal.Dockerfile`'s
  `CMD` and `HEALTHCHECK`, the template mirror under `packages/create-qcms-app/templates/`, and
  `outputFileTracingIncludes` for the wrapper itself;
- an adopter who runs `next start` rather than this image gets none of it.

### (b) the build-stamp pre-check the issue was written around: buildable, and now harmful

Buildable, and more cheaply than the issue assumed. React renders the step form as
`<form action="" encType="multipart/form-data" method="POST">`, and `action=""` resolves to the
document URL **including its query string**: verified in Chromium with `javaScriptEnabled: false`,
where pressing Add on `/zzprobe1035?b=stampA` posted to `/zzprobe1035?b=stampA` and the proxy saw
the query. So a stamp could ride the step page's URL with **no markup change and no body read**.

It should still not be built, for three reasons:

1. **It inverts section 1.** The stamp mismatches on every deploy, while the action id survives
   almost all of them. The friendly page would replace a post that was going to work. That is
   strictly worse than today.
2. **It pre-empts SEC-9's belt.** The proxy answers before the action runs, so a cross-site post
   carrying a valid action id and a stale stamp would get the friendly page instead of reaching
   `isSameOriginAction` and writing its `origin.belt.refused` line. Keeping the work order's
   requirement ("a refused-origin post must still be refused by the belt") would mean a third copy
   of the origin decision, in the proxy, beside the two gates
   `scripts/check-origin-guards.test.ts` enumerates.
3. **Rolling deploys make it fire both ways.** While two builds serve one hostname, a post stamped
   for either build can reach a replica running the other.

### (c) an ingress rule: accurate, and an adopter requirement that only one of the two shipped recipes can meet

Caddy can express it: a response matcher `@conflict status 409` with
`handle_response`, which can read `{rp.header.X-Nextjs-Action-Not-Found}` and `redir` or `rewrite`
to a page the portal owns. That is the cheapest and most accurate trigger, because the 409 plus the
header is the framework itself saying the id came from another build, and it fires only when the
skew is real.

The problem is `docs/deploy-ingress.md`'s **Recipe B**. An ALB matches listener rules on the
incoming request only (host, path, header, query, method, source IP); there is no condition on what
the target returned. So the friendly page would exist for Recipe A adopters and not for Recipe B
adopters, which makes it a property of somebody's proxy configuration rather than a property of the
product, and that is the exact thing `docs/deploy-ingress.md`'s preamble says keeping ingress out of
the base stack is for.

## 3. The recommendation, for the Code Owner to rule on

**Build none of the three. Correct the records, then pin the one thing the app controls.**

1. **Correct the false claim in all six places** named in section 1, with the measurements in
   section 1, in the same way ADR-43 already corrected its `E974` / `E975` attribution in place:
   a held page survives an ordinary deploy at 16.4.0, and skew needs a change to the action's
   identity. Everything downstream of that claim (how often the 409 happens, what the runbook tells
   an operator to expect, how much the friendly page is worth) reads differently once it is true.
2. **Pin `rosterOperation`'s identity with a gate**, since that pair is now known to be the whole
   skew surface: a check that `apps/portal/app/s/[sessionId]/roster-action.ts` still exports
   `rosterOperation` with its current signature, so a refactor that would break every held page is
   a red gate and a deliberate choice rather than an accident. This is cheap, needs no build
   artifact, and is in the app's own hands. It is a new control, so it is proposed rather than
   written.
3. **If the friendly page is still wanted for the residual case**, option (c) is the one to take,
   as an **optional** rule in the Caddy overlay QCMS already ships, documented in
   `docs/deploy-ingress.md` as a Recipe A nicety with Recipe B's inability to express it stated
   plainly, and with the page itself owned by the portal so it is accessible, localized and
   no-JS-safe wherever it is reached from. That keeps the 409 as the accepted baseline (ADR-43 as
   amended) and adds a softer landing where an ingress can give one, instead of promising a
   property the product cannot keep.

**The question for the Code Owner:** accept 1 and 2 and defer the page, or rule that the page is
worth option (c)'s ingress asymmetry (or option (a')'s custom server), in which case say which and
this lane builds it.

## 4. State of the branch

Clean apart from this file. The probe page, the temporary `proxy.ts` log line and the three
standalone build snapshots the measurements were taken from were all removed; nothing from the
investigation is committed. Gates run: see the hand-back report.
