---
"create-qcms-app": minor
---

**Breaking for a scaffolded API: request bodies now reject unknown keys** (Code Owner,
2026-09-19, issue #893). Pre-1.0, so there is no deprecation window.

A scaffolded app's route schemas were Zod objects with the default strip policy, and the
OpenAPI documents generated from them published no `additionalProperties` at all. The two
disagreed. `PATCH /admin/forms/{id}/settings` with `{"challengeRequired":true,"unknownField":1}`
answered 200 and dropped the second key, while a client generated from the document judged
the body valid; `{"unknownField":1}` answered 400 for the _empty patch_ rather than for the
key, because the key was stripped before the at-least-one-field rule ran. A misspelled
field was a success with no effect.

Every JSON request body is now declared through `jsonBody` in `apps/api/src/openapi.ts`,
which reads the schema's own unknown-key setting and throws when a route module is
imported if the body is neither a `z.strictObject` nor explicitly opened with a stated
reason. An undeclared key is a `400 INVALID_REQUEST` whose message names it, and the same
declaration publishes `additionalProperties: false` in `docs/openapi/*.json`, so the server
and a generated client can no longer disagree. The named keys are bounded, because they are
caller input reflected into a response body and a log line: five per issue, 64 characters
each including the marker that shows a key was cut, control and format characters removed.

Two kinds of schema deliberately stay open. Maps whose keys are caller data - the
kernel-validated question and form definitions, and the `questionId`-keyed answer maps -
keep describing their values rather than closing. And `POST /sessions/{id}/submit` remains a
loose object: its honeypot field name is deployment configuration and the no-JS portal path
forwards every posted form field the compiled document did not tag as an answer control, so
closing it would refuse legitimate submits and would let a bot find the honeypot by
comparing a 400 against a 200.

If you have customised a scaffolded route, declare its body with `z.strictObject` - the
import of its route module will tell you if you have not.
