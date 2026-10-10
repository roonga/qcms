---
"create-qcms-app": patch
---

Three things the scaffolded templates pick up from the monorepo, all generated rather than
edited by hand.

**A scaffolded build makes no upgrade-nudge network call.** Both app configs now set
`experimental.agentUpgrade: false`. At next 16.4.0 that option defaults to `"security"`,
and on the default `next/dist/lib/upgrade/nudge.js` reaches
`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` whenever
`@vercel/detect-agent` reports an agent - which piping the output and setting `CI=1` do not
suppress. A scaffolded project is an adopter's project, so the choice of whether a build
phones a registry for version advice belongs to them; the opt-out is the quieter default and
a one-line change to reverse. `experimental.agentFeedback` is untouched and still defaults
to off.

**No admin Server Action submit can be pressed before the page hydrates.** A submission that
leaves earlier posts as a full navigation, the scaffolded admin serves
`Referrer-Policy: no-referrer`, so the request carries `Origin: null`, and Next's action
handler refuses that outright rather than returning the rejected submission the form is built
to restore. `apps/admin/lib/hydrated.ts` is new and carries the signal; the create-form
submit is disabled until the attach, and the question editor's heading-row control was
already absent from the served bytes and now says why.

**A comment correction in the portal's message catalogue**, which named the status a stale
Server Action id used to get. At next 16.4.0 a well-formed unknown id gets `409` with
`Server Action unavailable.` and a malformed one `400`; it was a bare `500` for both at
16.3.x.

Nothing about what the scaffold produces changes beyond those: same files, same routes, same
environment.
