# HANDOFF: AWAITING-HUMAN rule on issue #1035, because the cause is a pinnable build salt and not a page that has to be dressed up

Branch `fix/1035-stale-action-page`, from `origin/main` at `ca9853b1`. **No page was built and no
record was amended.** The feasibility pass the work order asked for first went further than
expected: the `409` has a cause the app can remove rather than only a symptom the app can soften,
and the removal needs a new environment variable, a secret-handling policy and a SEC reading. Those
are Code Owner calls, so this parks with the measurements instead of choosing.

Nothing here is a decision taken. Every number below is reproducible by the method stated beside
it, and one earlier reading of mine was wrong and is corrected rather than deleted, because the
mistake is the instructive part.

## 1. The cause: Server Action ids are salted with a per-build random key, and Next lets you pin it

All measurements are against production `output: "standalone"` builds of this portal, served the way
`docker/portal.Dockerfile` serves them (`node apps/portal/server.js`, no `next dev` anywhere), with
a temporary probe page carrying a `useActionState` Server Action of the same shape as the step
form's. The probe page, a temporary log line in `proxy()` and every build tree were removed again;
nothing from the investigation is committed.

**The mechanism, read from the shipped framework.** `next build` generates a random AES-256 key per
build and keeps it in the build context: "Generate a random encryption key for this build. This key
is used to encrypt cross boundary values **and can be used to generate hashes**"
(`next/dist/build/index.js`). `generateEncryptionKeyBase64` returns
`process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` when it is set, and otherwise generates one
(`next/dist/server/app-render/encryption-utils-server.js`). Either way the key is written to
`<distDir>/cache/.rscinfo` with a **14-day expiry** and reused by later builds **in the same tree**,
and an env-provided key takes precedence over a cached one that differs from it.

**What that produces, measured:**

| Two builds                                                                                                                          | `encryptionKey` | the action's id                                                     | a POST captured from the first, replayed against the second                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| incremental (`.next` kept), same source                                                                                             | same            | same                                                                | `200`, the action ran                                                                             |
| incremental, action implementation **and** component changed, new unrelated action added                                            | same            | same                                                                | `200`, the action ran, with the new implementation                                                |
| **clean** (`rm -rf .next`), same source, no key pinned                                                                              | **different**   | **different**                                                       | **`409`** (see the negative control below)                                                        |
| **clean**, same source, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` pinned                                                                 | same            | **same**                                                            | `200`, the action ran                                                                             |
| **clean**, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` pinned, action implementation **and** component changed, new unrelated action added | same            | **same** (both existing ids survived; the new action added a third) | **`200`, the action ran, with the new implementation, and no `x-nextjs-action-not-found` header** |

**The negative control, and it is the strongest piece of evidence here.** A **real** id from a real
earlier build (`603073c5310dc4b8ba9c67147f1d0b4c03e77233d6`, read out of that build's own rendered
form) posted to a clean build with no key pinned answered **`409`, `content-type: text/plain`, body
`Server Action unavailable.`, header `x-nextjs-action-not-found: 1`**, with
`Failed to find Server Action "6030...". This request might be from an older or newer deployment.`
in the server log and not on the page. That is the exact failure #1035 is about, reproduced from a
genuinely stale id rather than a hand-made one, and it matches ADR-43's amendment exactly. A
malformed id (44 hex) answered `400` `Invalid Server Action request.` with the same header, and a
real id answered `200` `text/html` with no header.

**So: the records are right and the issue's framing is right.** A Docker image build is always a
clean build, so every image rotates the key, so every deploy of a newly built image invalidates
every action id, so any page held across it posts a stale one. **But the rotation is not inherent.**
It is a per-build random salt with a documented, supported way to pin it, and with it pinned the
held page simply works, including across a deploy that changed the action's own implementation.

**The reading I got wrong, and why it matters to anyone repeating this.** My first three builds were
**incremental**, so they reused the key cached in `.next/cache/.rscinfo` and produced identical
action ids. I read that as "ids are content-addressed, not build-salted" and had written a
recommendation on it. Two clean builds falsified it within the hour. Anyone measuring this locally
will see stable ids and conclude there is no problem, because a developer rebuilds in place and the
cached key lasts a fortnight; only a from-scratch build, which is the only kind a container does,
shows the real behaviour. That asymmetry is worth a line in whichever record this ends up in.

## 2. Feasibility of the three mechanisms the work order listed

### (a) something in-app that sees the outcome: **no Next hook exists at 16.4.0**

- `proxy.ts` runs **before** the route and has no response-side return path. Probed rather than
  assumed: a temporary log line in `proxy()` printed the multipart POST for all three cases, and
  the portal's CSP, `Referrer-Policy` and `x-request-id` are on all three responses, so the proxy
  ran and could not alter any of them.
- The only instrumentation hook is `onRequestError`
  (`next/dist/server/instrumentation/types.d.ts`), which returns `void | Promise<void>` and so
  cannot change a response. It is not even invoked here: `handleUnrecognizedAction`
  (`next/dist/server/app-render/action-handler.js`) `console.warn`s and returns
  `RenderResult.fromStatic(...)` with `res.statusCode` already set. Nothing throws.
- `serverActions` config carries `bodySizeLimit` and `allowedOrigins` and nothing else
  (`next/dist/server/config-shared.d.ts`). There is no unrecognized-action hook;
  `experimental.useSkewCookie` and `deploymentId` are Vercel skew protection, not a self-hosted
  interception point.
- Next's own comment at that call site states the intent: the blank body plus the header exist so
  "unrecognized actions can also be handled at the infra level (i.e. without needing to invoke a
  lambda)". The framework is pointing at option (c).

### (a') the custom server wrapper the work order names: possible, and ADR-level

`next.js` and `next-server.js` **are** traced into the standalone tree, so `next()` plus
`getRequestHandler()` in our own `http.createServer` would work (`startServer` also exports an
undocumented `getRequestHandlers`). The cost is why this is not a free (a): it replaces Next's
documented minimal standalone server with a hand-rolled one, against the standing preference
recorded in `apps/portal/next.config.ts`; the 409 is set late, so catching it means wrapping
`writeHead`, `write` and `end` on **every** portal response to swap a status and suppress a body
already queued; and it moves the deployment contract in three places that must stay in step
(`docker/portal.Dockerfile`'s `CMD` and `HEALTHCHECK`, the template mirror under
`packages/create-qcms-app/templates/`, and tracing config for the wrapper itself). An adopter who
runs `next start` gets none of it.

### (b) the build-stamp pre-check: buildable, cheaper than the issue assumed, and still wrong

Buildable with **no markup change and no body read**. React renders the step form as
`<form action="" encType="multipart/form-data" method="POST">`, and `action=""` resolves to the
document URL **including its query string**: verified in Chromium with `javaScriptEnabled: false`,
where pressing Add on `/zzprobe1035?b=stampA` posted to `/zzprobe1035?b=stampA` and the proxy saw
the query. So a stamp could ride the step page's own URL.

Two reasons not to take it even so:

1. **It pre-empts SEC-9's belt.** The proxy answers before the action runs, so a cross-site post
   carrying a valid action id and a stale stamp would get the friendly page instead of reaching
   `isSameOriginAction` and writing its `origin.belt.refused` line. Keeping the work order's own
   requirement ("a refused-origin post must still be refused by the belt and must not reach the
   friendly page") would mean a third copy of the origin decision, in the proxy, beside the two
   gates `scripts/check-origin-guards.test.ts` enumerates.
2. **It is a worse trigger than the one 16.4.0 already gives.** A stamp mismatch is a proxy's guess
   at skew; a `409` carrying `x-nextjs-action-not-found: 1` is the framework stating it. During a
   rolling deploy the stamp also fires in both directions, because a post stamped for either build
   can reach a replica running the other, while the 409 fires only on the replica that genuinely
   does not know the id.

### (c) an ingress rule: accurate, and only half-portable

Caddy can express it: a response matcher `@conflict status 409` with `handle_response`, which can
read `{rp.header.X-Nextjs-Action-Not-Found}` and `redir` or `rewrite` to a page the portal owns.
Cheapest and most accurate trigger, and it fires only on real skew.

`docs/deploy-ingress.md`'s **Recipe B** cannot. An ALB matches listener rules on the incoming
request only (host, path, header, query, method, source IP); there is no condition on what the
target returned. So the friendly page would exist for Recipe A adopters and not for Recipe B
adopters, making it a property of somebody's proxy configuration rather than of the product, which
is the exact thing that document's preamble says keeping ingress out of the base stack is for.

## 3. Recommendation, for the Code Owner to rule on

**Remove the cause where it can be removed, record it honestly, and treat the page as what is left
over rather than as the fix.**

1. **Record the real cause** in the five places that currently say only that Next recalculates
   action ids between builds: ADR-43's amendment (`docs/adr/portal.md`), Q28's consequence
   (`plan/repeating-groups-and-table-input.md`), `docs/features/073-repeat-rendering.md`,
   `apps/portal/app/s/[sessionId]/error.tsx` and the #504 runbook in `docs/operations.md`. The
   sentence is true but it reads as a framework law, and it is a per-build random salt with a
   supported way to pin it. Include the incremental-versus-clean asymmetry from section 1, because
   it is why nobody sees this locally.
2. **Offer `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to an adopter who builds their own image**, as the
   supported way to make held pages survive their own deploys: a **build-time** value (not runtime),
   so it belongs in `docker/portal.Dockerfile` as a build arg, in `.env.compose.example`, in
   `docs/deploy-ingress.md` and in the typed environment registry, with the caveat that it is a
   secret and must not be committed. With it set, section 1's last row is the behaviour: the held
   page works.
3. **Do not bake one shared key into the published `ghcr.io/roonga/qcms-portal` images.** One
   long-lived secret shared by every adopter of the published images is worse than a `409` on a
   version upgrade. For an adopter on the published images the exposure is already narrow: repeated
   deploys of the **same** image have identical ids, so skew needs an upgrade to a new QCMS release,
   which is a genuine code change.
4. **Then decide the page on what is left**, which is a QCMS version upgrade landing while a no-JS
   respondent holds a repeating step. If it is still wanted, (c) is the one to take, as an
   **optional** rule in the Caddy overlay QCMS already ships, documented as a Recipe A nicety with
   Recipe B's inability to express it stated plainly, and with the page owned by the portal so it is
   accessible, localized and no-JS-safe. (b) is refused for the SEC-9 ordering reason above; (a') is
   ADR-level.

**The questions for the Code Owner.** Is 2 plus 3 the shape wanted, given that it introduces a
build-time secret to the portal image and a SEC entry for it? And is the residual case after that
worth option (c)'s ingress asymmetry, or does the `409` stay the accepted answer for it? Either
answer is implementable from here; the recommendation is 1, 2 and 3 now, with 4 deferred until the
residual is the only thing left.

## 4. State of the branch

Clean apart from this file. Gates run: see the hand-back report.
