---
"@qcms/db": minor
---

Add the `webhooks` table (migration 0006) and its shape-preserving query helpers
(`insertWebhook`, `listWebhooks`, `getWebhook`, `updateWebhook`,
`deactivateWebhook`), plus `listSecureLinks` for the admin secure-link listing.

The webhook secret is stored **encrypted at rest** (SEC-6): the `secret_encrypted`
column holds opaque AES-256-GCM ciphertext produced by the shell under
`QCMS_APP_KEY` - the database never sees the plaintext, and 025 recovers it to
sign deliveries. Deletion is a soft-deactivate (sets `active = false`, stamps
`deactivated_at`) so delivery history survives. The task 024 admin slices
(secure-link minting/revocation and webhook config) build on these.
