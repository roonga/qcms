# Issue 323 findings: what `QCMS_APP_KEY` actually encrypts, and whether it can be rotated

**Status: decision input, not a decision.** This note exists so the Code Owner can choose
between the two resolutions issue 323 offers (implement a re-encrypt job, or amend SEC-7 to
say plainly that a change is a break). No behaviour, doc or source file was changed by the
investigation that produced it. Delete this file in the change that lands the chosen
resolution.

Evidence gathered against `origin/main` at `14a81ff`.

## 1. What `QCMS_APP_KEY` encrypts at rest today

**Exactly one column: `webhooks.secret_encrypted` (Postgres `text`, no length limit).**

| Table | Column | Plaintext | Written by | Read by |
|---|---|---|---|---|
| `webhooks` | `secret_encrypted` | the per-webhook HMAC signing secret, `whsec_` + 32 random bytes as base64url (49 chars) | `apps/api/src/features/webhooks/handler.ts:131` (create) and `:191` (explicit rotate) | `apps/api/src/schedulers/outbox-delivery.ts:275` (decrypt at delivery time to compute `X-QCMS-Signature`) |

Traced by following `config.keys.app` (`apps/api/src/config.ts:607`, `:100`) to every consumer.
`encryptWebhookSecret` / `decryptWebhookSecret` in
`apps/api/src/features/webhooks/crypto.ts` are the only functions that take the app key, and
the four call sites above are their only non-test callers. No other schema column holds
anything encrypted under this key: a sweep of `packages/db/src/schema/*.ts` for
`encrypt`/`cipher`/`secret` finds only this column plus `twoFactor.secret`, which belongs to
another key (below).

### Code and docs disagree, and the code wins

Three operator-facing places claim `QCMS_APP_KEY` also encrypts **stored TOTP material**:

- `docs/operations.md:112` (generated block): "encrypting secrets at rest: webhook signing
  secrets and stored TOTP material (SEC-6)"
- `scripts/env-reference.mjs:169-176`, the generator that produces that line
- `docs/backup-restore.md:25-27`: "`QCMS_APP_KEY` encrypts webhook signing secrets and stored
  TOTP material at rest (SEC-6)"

That is **false**. The TOTP secret in `twoFactor.secret` (`packages/db/src/schema/auth.ts:87`)
is written by better-auth's two-factor plugin under `ctx.context.secretConfig`, which is the
`secret` option QCMS sets from `QCMS_ADMIN_AUTH_SECRET`
(`apps/api/src/features/auth/instance.ts:159`, `apps/api/src/config.ts:543`). Confirmed in the
installed better-auth 1.6.26: `dist/plugins/two-factor/index.mjs:105` calls
`symmetricEncrypt({ key: ctx.context.secretConfig, data: secret })`, and both verification
paths decrypt with the current key. `docs/SECURITY_DESIGN.md:136` already states this
correctly for `QCMS_ADMIN_AUTH_SECRET`; the three places above simply attribute the same
material to the wrong key. The practical effect is that the two keys' blast radii are being
described as overlapping when they are disjoint, which makes both harder to reason about.

## 2. Does the stored ciphertext carry a key id or version?

**It carries a scheme version. It carries no key id, and nothing anywhere records which key a
row was encrypted under.**

Read from the actual stored bytes: a webhook was created through the real admin route against
a Testcontainers Postgres, then the column was read back with a raw `sql` query rather than
through the query builder.

```
pg column type            text (character_maximum_length null)
stored total length       107 chars
prefix                    "v1."   (bytes 76 31 2e, ASCII, not part of the base64)
base64 body               104 chars, standard alphabet (+ /), no padding stripped
decoded                   77 bytes = 12 IV || 49 ciphertext || 16 GCM tag
```

Structure, payload redacted:

```
v1.<base64( iv[12] || ciphertext[len(plaintext)] || tag[16] )>
```

The `v1.` prefix is a **scheme** marker (which algorithm and envelope layout), not a **key**
marker (which key was used). Its only reader in the tree is the guard at
`apps/api/src/features/webhooks/crypto.ts:83`, `if (!stored.startsWith(SCHEME_PREFIX))`, plus
two test assertions (`crypto.test.ts:23`, `webhooks.integration.test.ts:110`). Nothing selects
a key from it, and there is no key-id field, no `key_version` column, and no per-row metadata
of any kind. `deriveKey` is `SHA-256(QCMS_APP_KEY)` with no salt, so two different app keys
produce envelopes that are byte-indistinguishable in shape.

**This is the load-bearing fact.** Mid-pass, a re-encrypt job would leave the table holding
rows under two keys with nothing to tell them apart, and the only way to classify a row would
be trial decryption: try the new key, and on `WebhookSecretDecryptError` try the old one.
That works because AES-GCM authenticates (a wrong key fails the tag check rather than
returning garbage), so trial decryption is sound rather than merely probable. It is, however,
an inference from a failure rather than an observation of progress, so a job built that way
cannot report "N of M rows migrated" without doing the trial pass first.

## 3. Volume, batching, and whether it could run online

**Volume is trivial.** One row per configured webhook endpoint. Nothing ever deletes a
`webhooks` row: `DELETE` is a soft deactivation (`active = false` plus `deactivated_at`,
`schema/webhooks.ts`), and neither `queries/retention.ts` nor `queries/erasure.ts` touches the
table, so the row set grows monotonically with endpoints ever configured. There is no cap on
webhooks per form (`docs/webhooks.md:23`). A realistic deployment is tens of forms with one to
three endpoints each: order 10^1 to 10^2 rows, with 10^3 to 10^4 a generous ceiling for a
large multi-tenant install. Deactivated rows must be included in any pass, since a
reactivation later would otherwise resurrect an undecryptable secret.

**Cost is dominated by nothing.** Measured in-process: 5000 decrypt-then-re-encrypt cycles,
including a fresh SHA-256 key derivation on both sides of each cycle, take 1.0 s, about 200
microseconds per row. A real job derives both keys once and would be several times faster than
that. At any plausible row count the whole pass is a handful of database round trips and the
crypto is free. **Batching is not needed for time; resumability is needed for correctness**,
because a crashed pass leaves a mixed table and the operator needs to be able to run it again
without knowing where it stopped.

**Resumable batching is easy structurally.** `webhook_id` is the text primary key, so keyset
pagination (`where webhook_id > $cursor order by webhook_id limit N`) is available with no new
index. Each row's update is independent, and no append-only or immutability trigger covers
this table (`migrations/0006_webhooks.sql` adds none, and the triggers in `0001` predate it),
so `updateWebhook` already writes the column freely.

**Online is where it gets awkward, and the reason is process topology rather than data.**
`QCMS_APP_KEY` is a single scalar read from the environment at boot
(`config.ts:607`), not a list like `QCMS_LINK_KEYS`. A running deployment therefore holds
exactly one app key per process, and `docs/deploy-enterprise.md:103` puts `QCMS_APP_KEY` on
both `api-public` and `api-internal`, the latter scaled to N instances. So during a rotation
there is an unavoidable window in which some instances hold the old key and some the new, and
whichever instance runs the delivery scheduler will fail on rows that are not under its key.
The failure is visible and bounded: `outbox-delivery.ts:275-280` catches the decrypt error and
records `secret_decrypt_failed`, which retries and then dead-letters. Nothing corrupts, but
deliveries dead-letter during the window. Making it genuinely online would need the key to
become a list (first encrypts, all attempt decryption), which is a config-shape change, not
just a job.

## 4. What operator-facing files currently say about rotating `QCMS_APP_KEY`

The claim the issue objects to exists in exactly one place:

- **`docs/SECURITY_DESIGN.md:131`**, the SEC-7 inventory:

  > `| App encryption key | `QCMS_APP_KEY` (32B) | until rotated | config only | re-encrypt job, documented |`

  Neither half is true. There is no re-encrypt job anywhere in the tree (a repo-wide search for
  `re-encrypt` finds this row, the `RETRO.md` entry that flagged it, and one unrelated sentence
  about rotating a webhook's own secret), and no document describes the procedure. Two lines
  above, the same table's `Lifetime` column says "until rotated", which reinforces the
  impression that rotation is a supported operation.

- **`docs/SECURITY_DESIGN.md:144`** (SEC-8 prose) says the ciphertext format is "versioned
  ciphertext format for key rotation". Versioned it is, but by scheme, not by key, so the
  version does not enable rotation. Finding 2 above.

- **`docs/SECURITY_DESIGN.md:134`**: "Rotation runbooks live in `docs/operations.md` (036)."
  `docs/operations.md` has exactly one rotation runbook, "Secure-link key rotation" at line
  329, covering `QCMS_LINK_KEYS` and `QCMS_SESSION_KEYS`. Nothing there mentions
  `QCMS_APP_KEY`.

**And this is the split the issue warned about.** `.env.compose.example`, the file operators
copy, says this and nothing else:

```
QCMS_APP_KEY=replace-with-a-random-32-character-app-encryption-key
```

One line, no note. The very next entry in the same file, `QCMS_ADMIN_AUTH_SECRET`, carries the
full sixteen-line warning that PR 320 added ("SET IT ONCE AND DO NOT CHANGE IT ..."). So an
operator reading the copied file learns that one at-rest key must never change and learns
nothing at all about the other, while the design document tells them a re-encrypt job exists
for it. The two documents mislead in opposite directions.

Everything else that mentions the variable is accurate about the consequence but silent on
rotation:

- `docs/operations.md:112` and `scripts/env-reference.mjs:169-176`: "Changing it makes every
  existing at-rest secret undecryptable." Correct as far as it goes (the TOTP attribution in
  the same sentence is not, see finding 1). No procedure, no mention of the recovery path
  below.
- `docs/backup-restore.md:25-27`: "a database restored alongside a different `QCMS_APP_KEY`
  comes back with those columns permanently undecryptable", then at `:185` the drill
  instruction to restore with the backed-up key. Accurate, and it is the only file that treats
  the key as backup-critical.
- `docs/webhooks.md:36-49`: describes the derivation and the exact `v1.` stored form; the
  "Rotation" bullet there is about rotating a **webhook's** secret, not the app key.
- `docs/deploy-enterprise.md:103`: which services need the variable. No rotation claim.

## 5. The recovery path that already exists, and that no document mentions

This is the fact that most changes the shape of the decision, so it is called out separately.

**`QCMS_APP_KEY` is not in the same category as `QCMS_ADMIN_AUTH_SECRET`, despite the RETRO
entry that pairs them.** Losing the admin auth secret is unrecoverable by design: the TOTP
secret cannot be regenerated server-side without the user re-enrolling, and there is no
re-enrolment screen at launch, so ten recovery codes are the only door.

Losing the app key is different, because **the webhook secret can be regenerated
unilaterally**. `makeUpdateWebhookHandler` (`handler.ts:186-191`) mints a fresh secret and
encrypts it under the current key **without ever reading the old ciphertext**, and the admin
UI exposes it as a per-webhook "Rotate secret" button
(`apps/admin/app/(shell)/forms/[formId]/webhooks/page.tsx:68`,
`apps/admin/lib/server/webhook-ops.ts:84`). So after an app-key change the operator procedure
is: rotate each webhook's secret in the admin, and give each consumer its new secret.

The cost is therefore **not data loss. It is re-coordinating a shared secret with every
webhook consumer**, plus dead-lettered deliveries in between (which are redeliverable from the
dead-letter view once the secrets are fixed). At one to three endpoints per form that is an
afternoon of emails, not an incident. That is worth saying plainly whichever resolution is
chosen, because right now no document says it at all, and an operator facing a suspected key
compromise would reasonably conclude from `backup-restore.md` that they are looking at
permanent loss.

## 6. Sketch A: what a resumable re-encrypt job would have to look like

Shape, given findings 2 and 3.

**Where it lives.** A compiled CLI entry beside `apps/api/src/create-admin.ts`, exposed as
`pnpm qcms:reencrypt-app-key`. Same reasoning as the comment at the top of `create-admin.ts`:
it has to run inside the API container via `docker compose exec api`, and only `dist` is
copied into the image, so a `scripts/*.ts` entry would not be present. It reads only the
slice of config it needs, not the whole of it.

**How it takes both keys.** `QCMS_APP_KEY` stays the destination key, read as today. The
source key arrives as a second variable the job alone reads, `QCMS_APP_KEY_PREVIOUS`, in the
environment and never as an argument (`create-admin.ts` sets that precedent explicitly:
arguments land in shell history and in every `ps` listing). Neither value is echoed, on
success or failure (SEC-8).

**The pass.** Keyset pagination over the primary key, one transaction per batch:

```
for each batch of N rows ordered by webhook_id > cursor:
  for each row:
    try   decrypt(secret_encrypted, NEW)  -> already migrated, skip
    catch decrypt(secret_encrypted, PREV) -> re-encrypt under NEW, update
    catch -> unmigratable: count it, name the webhook_id, do not fail the pass
  commit; advance cursor; print "migrated X, already-new Y, unmigratable Z, cursor ..."
```

Trial decryption in that order is what substitutes for the missing key id, and it is sound
because AES-GCM's tag makes a wrong key a clean failure rather than garbage. It also makes the
job **idempotent**: a second run finds every row already under the new key and changes
nothing, which is exactly what an operator needs after an interrupted first run. It must
include `active = false` rows.

**Reporting.** Counts only, plus `webhook_id`s for the unmigratable set. Never a secret, never
a key, never a ciphertext.

**Operator sequence, and its honest downtime story.** Because the key is a scalar and not a
list, there is no zero-downtime version of this without a config-shape change:

1. Stop the `internal` instances, or accept that deliveries dead-letter during the pass. That
   is the only process that decrypts (`outbox-delivery.ts`).
2. Run the job with `QCMS_APP_KEY` = new and `QCMS_APP_KEY_PREVIOUS` = old.
3. Roll the new `QCMS_APP_KEY` out to every service that carries it and restart.
4. Unset `QCMS_APP_KEY_PREVIOUS` everywhere.

**Testing, at the layer ADR-23 names.** A `@qcms/db` Testcontainers integration test: seed
rows under key A, run the pass to key B, assert every row decrypts under B and none under A;
kill the pass mid-batch and re-run, asserting the same end state and no double-encryption;
assert a row that decrypts under neither key is reported rather than fatal; assert the job
never writes a decryptable value to stdout.

**Rough size.** One new `dist` entry, one query helper (`listWebhooksForReencrypt`, which is
the three-place edit: `queries/webhooks.ts`, `queries/index.ts`, the `import-surface.test.ts`
allowlist), one integration test file, one runbook section in `docs/operations.md`, plus the
`.env.compose.example` and SEC-7 wording. It is a real but small task. The part that is *not*
small, and that this sketch deliberately does not attempt, is making the key a list so the
pass can run online.

## 7. Sketch B: the honest wording if the answer is "it is a break, not a rotation"

Replacement for the SEC-7 row at `docs/SECURITY_DESIGN.md:131`:

> `| App encryption key | `QCMS_APP_KEY` (32B) | set once | config only | **no in-place rotation exists** - see the note below |`

Note to follow the existing `QCMS_ADMIN_AUTH_SECRET` paragraph, matching its form:

> **`QCMS_APP_KEY` is the second at-rest key with no rotation path, and it is a different
> shape of loss from the first.** It is a single scalar, not a key list, and the stored
> envelope (`v1.<base64(iv || ciphertext || tag)>` in `webhooks.secret_encrypted`) carries a
> scheme version but **no key id**, so nothing can tell which key encrypted a given row.
> Changing the value makes every stored webhook signing secret undecryptable at once; the
> deliverer records `secret_decrypt_failed` and those deliveries dead-letter. Unlike
> `QCMS_ADMIN_AUTH_SECRET`, this is recoverable without the old key, because the webhook
> secret is server-generated and can be replaced without reading the old one: rotate each
> webhook's secret in the admin ("Rotate secret" on the form's Webhooks page), hand each
> consumer its new secret, and redeliver the dead-lettered items. The cost is re-coordinating
> a shared secret with every consumer, not data loss. Treat the key as set-once and back it up
> with the database; an actual rotation story (making it an accepted-list key so a re-encrypt
> pass can run online) is Phase 4 work.

The same fact belongs in `.env.compose.example` above the `QCMS_APP_KEY` line, at the length
`QCMS_ADMIN_AUTH_SECRET` sets there, and as a short runbook entry in `docs/operations.md`
beside "Secure-link key rotation" so that section stops implying the list model covers every
key. `docs/backup-restore.md` should gain the recovery sentence, since today it describes the
loss and not the way out.

## 8. Adjacent findings, reported not fixed

- **The TOTP misattribution** in `docs/operations.md:112`, `scripts/env-reference.mjs:169-176`
  and `docs/backup-restore.md:25-27` (finding 1). Whichever resolution is chosen touches those
  files anyway, so it is cheap to correct in the same change. Note `docs/operations.md`'s table
  is generated: the edit belongs in `scripts/env-reference.mjs`, then
  `node scripts/env-reference.mjs --write`.
- **SEC-7's `Webhook secret` row claims a "dual-signing window"** (`SECURITY_DESIGN.md:129`,
  expanded at `:93` as "implement as dual-signature headers during rotation"). The deliverer
  sets a single `x-qcms-signature` header (`outbox-delivery.ts:294-299`), and
  `docs/webhooks.md:47-49` says the overlap window is a delivery-time concern that 024 does not
  store. So this is a second SEC-7 row asserting a capability that is not in the tree, in the
  same table and about the same feature. Task 040 lists "webhook dual-signing" among the
  rotation overlaps it will verify (`docs/features/040-security-review-hardening.md:14`), so it
  will be found there if it is not raised first. Separate issue, not part of 323.
