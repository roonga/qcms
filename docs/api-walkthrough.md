# qcms API walkthrough

The whole product, end to end, at the curl level - the same path scenario 1 of the
e2e suite (`apps/api/e2e/01-full-loop.e2e.ts`) drives. An operator authors the
canonical **insurance** form, wires a webhook, and mints a secure link; a
respondent walks the branching flow through that link; the signed webhook lands;
the response exports and is then erased.

This is descriptive documentation of the current build. The machine-readable
description of every route lives in the generated OpenAPI documents
(`docs/openapi/respondent.json`, `docs/openapi/admin.json`), regenerated with
`pnpm openapi:generate`. Neither is a compatibility promise until `/api/v1`
(`ARCHITECTURE.md` §5.1); both carry `x-stability: internal`.

## Surfaces, prefixes, and credentials

- **Respondent (public)** routes mount at the root: `POST /sessions`,
  `GET /sessions/{id}/step`, `POST /sessions/{id}/answers`, `POST /sessions/{id}/submit`.
- **Admin** routes mount under `/admin`. In a public-only process the admin group
  is not mounted at all - those paths 404, never 403 (ADR-09).
- Every mounted request carries the internal service token:
  `x-qcms-internal-token: <token>` (SEC-4).
- Admin requests add a session marker: `x-qcms-admin-session: <marker>` (a launch
  stub; 031 swaps in a real better-auth session).
- Respondent session-scoped calls carry the bearer token minted by `POST /sessions`:
  `Authorization: Bearer <sessionToken>`.

Below, `$API` is the base URL, `$INT` the internal token, `$ADM` the admin marker.

## 1. Author the question library (admin)

Questions are versioned; the insurance form pins `q_smoker@2` and `q_cigs_daily@1`.

```sh
# Create q_smoker (its definition carries the questionId). Returns v1 (draft).
curl -sX POST "$API/admin/questions" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" \
  -H 'content-type: application/json' \
  -d '{"slug":"smoker","definition":{"type":"boolean","questionId":"q_smoker","label":{"en":"Do you currently smoke?"},"required":true}}'

# Publish v1, append v2 (seeded from the latest draft), publish v2.
curl -sX POST "$API/admin/questions/q_smoker/versions/1/publish" -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"
curl -sX POST "$API/admin/questions/q_smoker/versions"           -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"
curl -sX POST "$API/admin/questions/q_smoker/versions/2/publish" -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"

# Create + publish q_cigs_daily v1.
curl -sX POST "$API/admin/questions" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"slug":"cigs","definition":{"type":"number","questionId":"q_cigs_daily","label":{"en":"How many cigarettes per day?"},"required":true,"constraints":{"min":0,"max":200,"integer":true}}}'
curl -sX POST "$API/admin/questions/q_cigs_daily/versions/1/publish" -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"
```

## 2. Create, draft, and publish the form (admin)

The draft is plain JSON - steps that pin question versions, plus a `rules` array.
The server compiles the A2UI at **publish** time (never at serve time, ADR-18). A
draft with a rule error still saves (issues are advisory); publish rejects it with
`422 PUBLISH_REJECTED`.

```sh
curl -sX POST "$API/admin/forms" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"formId":"frm_life_signup","slug":"life","defaultLocale":"en"}'

# Save the draft: one step, and a rule that shows q_cigs_daily only when q_smoker = true.
curl -sX PUT "$API/admin/forms/frm_life_signup/draft" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"definition":{"formId":"frm_life_signup","defaultLocale":"en","title":{"en":"Life insurance sign-up"},
       "steps":[{"stepId":"stp_health","title":{"en":"Health"},
                 "items":[{"questionId":"q_smoker","version":2},{"questionId":"q_cigs_daily","version":1}]}],
       "rules":[{"ruleId":"rul_smoker_followup","when":{"op":"equals","questionId":"q_smoker","value":true},"show":["q_cigs_daily"]}]}}'

# Publish → { "version": 1, "publishedAt": "…" }
curl -sX POST "$API/admin/forms/frm_life_signup/publish" -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"
```

## 3. Wire a webhook and mint a secure link (admin)

```sh
# Configure a webhook. The plaintext secret is returned exactly once - store it.
curl -sX POST "$API/admin/forms/frm_life_signup/webhooks" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"url":"https://consumer.example.com/qcms-hook","secret":"whsec_your_secret_value"}'
# → { "webhookId":"whk_…", "url":"…", "active":true, "secret":"whsec_your_secret_value", … }

# Mint a secure link. The token appears only inside the returned url (…/l/<token>).
curl -sX POST "$API/admin/forms/frm_life_signup/links" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"expiresAt":"2030-01-01T00:00:00.000Z","oneTime":false,"count":1}'
# → { "links":[{ "linkId":"lnk_…", "url":"https://portal.example/l/<token>", "expiresAt":"…" }] }
```

## 4. Walk the branching flow (respondent)

```sh
# Start a session with the link token (or {"formSlug":"life"} for an anonymous start).
curl -sX POST "$API/sessions" \
  -H "x-qcms-internal-token: $INT" -H 'content-type: application/json' \
  -d '{"token":"<token>"}'
# → { "sessionId":"ses_…", "sessionToken":"…", "formVersion":1, "expiresAt":"…" }

# Read the current step. Initially only q_smoker is visible.
curl -s "$API/sessions/$SES/step" -H "x-qcms-internal-token: $INT" -H "Authorization: Bearer $TOK"
# → { "step":{ "stepId":"stp_health", "root":{…A2UI…} }, "a2uiSpecVersion":"…",
#     "flowState":{ "currentStep":"stp_health", "visibleQuestions":["q_smoker"],
#                   "missingRequired":["q_smoker"], "readyToSubmit":false }, "progress":{…} }

# Answer q_smoker = true → the q_cigs_daily branch appears.
curl -sX POST "$API/sessions/$SES/answers" \
  -H "x-qcms-internal-token: $INT" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"questionId":"q_smoker","value":true}'
# → flowState.visibleQuestions now includes "q_cigs_daily".

# Answer q_smoker = false → the branch disappears; the flow is complete.
curl -sX POST "$API/sessions/$SES/answers" \
  -H "x-qcms-internal-token: $INT" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"questionId":"q_smoker","value":false}'
# → step:null, flowState.readyToSubmit:true.

# Submit → the receipt. Idempotent; a flagged (honeypot/too-fast) submit returns the
# same shape but withholds the webhook.
curl -sX POST "$API/sessions/$SES/submit" \
  -H "x-qcms-internal-token: $INT" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{}'
# → { "submittedAt":"…", "contentHash":"<hex sha-256>" }
```

## 5. The signed webhook

A clean submission enqueues one `response.submitted` event; the delivery pass signs
and POSTs it to every active webhook for the form. The delivered request carries:

- `x-qcms-event: response.submitted`
- `x-qcms-timestamp: <unix-seconds>`
- `x-qcms-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`
- body: `{ "eventId","eventType","deliveredAt","payload":{ sessionId, formId, formVersion, contentHash, submittedAt, answers } }`

Verify it exactly as the consumer would (full recipe in `docs/webhooks.md`):

```js
const expected = `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
// constant-time compare expected === req.headers["x-qcms-signature"]
```

The locked answers exclude any question hidden at submit time (I6): here the payload
carries only `q_smoker`.

## 6. Export and erase (admin)

```sh
# CSV (version required): UTF-8 BOM, CRLF, columns session_id,form_version,submitted_at,access_mode,<questionIds…>
curl -s "$API/admin/forms/frm_life_signup/export?format=csv&version=1" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"

# JSON (may span versions): an array of { sessionId, formId, formVersion, submittedAt, accessMode, answers }
curl -s "$API/admin/forms/frm_life_signup/export?format=json" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"

# Erase a session (idempotent). Afterwards it is gone from every export and a
# tombstone is listed under /admin/erasures.
curl -sX POST "$API/admin/sessions/$SES/erase" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM" -H 'content-type: application/json' \
  -d '{"reason":"subject request"}'
# → { "sessionId","formId","formVersion","erasedAt","reason","alreadyErased":false }

curl -s "$API/admin/erasures?formId=frm_life_signup" \
  -H "x-qcms-internal-token: $INT" -H "x-qcms-admin-session: $ADM"
# → { "erasures":[{ "sessionId","formId","formVersion","erasedAt","reason" }] }
```

## Typed failures

Every guard returns the shared error envelope `{ "error": { "code", "message", "details"? } }`
with a stable code, e.g. `PUBLISH_REJECTED` (422), `INVALID_ANSWER` (422),
`LINK_EXPIRED` (403), `LINK_CONSUMED` (409), `SESSION_SUBMITTED` (409),
`FORM_NOT_FOUND` (404). Scenario 5 of the e2e suite exercises these end to end.
