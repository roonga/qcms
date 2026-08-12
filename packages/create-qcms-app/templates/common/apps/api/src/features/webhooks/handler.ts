/**
 * Webhook-config admin handlers (task 024, SEC-6).
 *
 * Honest transaction scripts (R5): the slice validates the target URL against
 * the SSRF policy, encrypts the secret at rest, and reads/writes `webhooks` rows
 * through `@qcms/db` - no cross-row invariant lives in the kernel here. Handlers
 * are fetch-pure (R4): time via `deps.clock`, crypto via WebCrypto
 * (`./crypto.js`), no `node:*`.
 *
 * **Secret handling (SEC-6/SEC-8).** The plaintext secret exists in memory only
 * long enough to (a) return it once, on create or explicit rotate, and (b)
 * encrypt it for storage. It is never logged and never returned on a read. The
 * stored column holds AES-256-GCM ciphertext under `QCMS_APP_KEY`; 025 decrypts
 * it to sign deliveries.
 *
 * Row types come straight from `@qcms/db`: the `webhooks` row is enum-free and
 * the enum-bearing `forms` row is now hand-authored and sound across the package
 * boundary (issue #5), so both are consumed directly with no local launder.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { type FormId, parseFormId } from "@qcms/core";
import {
  deactivateWebhook,
  getForm,
  getWebhook,
  insertWebhook,
  listWebhooks,
  updateWebhook,
  type WebhookRow,
} from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { encryptWebhookSecret, generateWebhookSecret } from "./crypto.js";
import { checkWebhookUrl, type WebhookUrlRejection } from "./ssrf.js";
import type {
  createWebhookRoute,
  deactivateWebhookRoute,
  listWebhooksRoute,
  updateWebhookRoute,
} from "./route.js";

// --- typed failures ---------------------------------------------------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  webhookNotFound: (): ApiError =>
    new ApiError("WEBHOOK_NOT_FOUND", 404, "No such webhook for this form"),
  urlRejected: (reason: WebhookUrlRejection): ApiError =>
    new ApiError("WEBHOOK_URL_REJECTED", 422, urlRejectionMessage(reason), { reason }),
} as const;

function urlRejectionMessage(reason: WebhookUrlRejection): string {
  switch (reason) {
    case "not-a-url":
      return "The webhook URL is not a valid absolute URL";
    case "unsupported-scheme":
      return "The webhook URL must use http or https";
    case "https-required":
      return "The webhook URL must use https (set QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem http targets)";
    case "private-host":
      return "The webhook URL resolves to a private/reserved host (set QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets)";
  }
}

// --- shared helpers ---------------------------------------------------------

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

async function requireForm(deps: Deps, formId: FormId): Promise<void> {
  const form = await getForm(deps.db, formId);
  if (form === undefined) throw fail.formNotFound();
}

/** A fresh `whk_` id: 16 random hex bytes (config infrastructure, not a domain id). */
function newWebhookId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `whk_${hex}`;
}

/** Validate the target URL against the SSRF policy or throw a 422. */
function requireAllowedUrl(deps: Deps, raw: string): string {
  const checked = checkWebhookUrl(raw, deps.config.webhooks.allowPrivateTargets);
  if (!checked.ok) throw fail.urlRejected(checked.reason);
  return checked.url;
}

/** Map a stored row to the masked summary shape (never includes the secret). */
function toSummary(row: WebhookRow): {
  webhookId: string;
  url: string;
  active: boolean;
  hasSecret: true;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    webhookId: row.webhookId,
    url: row.url,
    active: row.active,
    hasSecret: true,
    deactivatedAt: row.deactivatedAt === null ? null : row.deactivatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- POST /admin/forms/:id/webhooks -----------------------------------------

export function makeCreateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof createWebhookRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    await requireForm(deps, formId);

    const url = requireAllowedUrl(deps, body.url);
    // Secret: caller-supplied or generated. Shown once, encrypted for storage.
    const secret = body.secret ?? generateWebhookSecret();
    const secretEncrypted = await encryptWebhookSecret(secret, deps.config.keys.app);

    const row = await insertWebhook(deps.db, {
      webhookId: newWebhookId(),
      formId,
      url,
      secretEncrypted,
      active: body.active,
    });

    return c.json(
      {
        webhookId: row.webhookId,
        formId,
        url: row.url,
        active: row.active,
        secret, // one-time reveal (SEC-6)
        createdAt: row.createdAt.toISOString(),
      },
      201,
    );
  };
}

// --- GET /admin/forms/:id/webhooks ------------------------------------------

export function makeListWebhooksHandler(
  deps: Deps,
): RouteHandler<typeof listWebhooksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    await requireForm(deps, formId);

    const rows = await listWebhooks(deps.db, formId);
    return c.json({ webhooks: rows.map(toSummary) }, 200);
  };
}

// --- PUT /admin/forms/:id/webhooks/:webhookId -------------------------------

export function makeUpdateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof updateWebhookRoute, ApiEnv> {
  return async (c) => {
    const { id, webhookId } = c.req.valid("param");
    const formId = requireFormId(id);
    const body = c.req.valid("json");

    const existing = await getWebhook(deps.db, formId, webhookId);
    if (existing === undefined) throw fail.webhookNotFound();

    const url = body.url === undefined ? undefined : requireAllowedUrl(deps, body.url);

    // Rotation is explicit: `rotateSecret: true` (generate) or an explicit
    // `secret`. Absent both, the secret is untouched and never re-revealed.
    const rotating = body.rotateSecret === true || body.secret !== undefined;
    let newSecret: string | undefined;
    let secretEncrypted: string | undefined;
    if (rotating) {
      newSecret = body.secret ?? generateWebhookSecret();
      secretEncrypted = await encryptWebhookSecret(newSecret, deps.config.keys.app);
    }

    const updated = await updateWebhook(deps.db, formId, webhookId, {
      ...(url === undefined ? {} : { url }),
      ...(secretEncrypted === undefined ? {} : { secretEncrypted }),
      ...(body.active === undefined ? {} : { active: body.active }),
      // Reactivating clears the deactivation stamp; deactivating stamps it.
      ...(body.active === undefined
        ? {}
        : { deactivatedAt: body.active ? null : deps.clock.now() }),
      now: deps.clock.now(),
    });
    if (updated === undefined) throw fail.webhookNotFound();

    return c.json(
      {
        webhookId: updated.webhookId,
        url: updated.url,
        active: updated.active,
        deactivatedAt: updated.deactivatedAt === null ? null : updated.deactivatedAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        ...(newSecret === undefined ? {} : { secret: newSecret }), // one-time reveal
      },
      200,
    );
  };
}

// --- DELETE /admin/forms/:id/webhooks/:webhookId ----------------------------

export function makeDeactivateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof deactivateWebhookRoute, ApiEnv> {
  return async (c) => {
    const { id, webhookId } = c.req.valid("param");
    const formId = requireFormId(id);

    const row = await deactivateWebhook(deps.db, formId, webhookId, deps.clock.now());
    if (row === undefined) throw fail.webhookNotFound();

    return c.json(
      {
        webhookId: row.webhookId,
        active: false as const,
        deactivatedAt: (row.deactivatedAt ?? deps.clock.now()).toISOString(),
      },
      200,
    );
  };
}
