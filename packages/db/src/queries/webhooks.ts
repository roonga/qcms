import { and, desc, eq } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { webhooks } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type WebhookRow = typeof webhooks.$inferSelect;

/**
 * Insert a configured webhook. `secretEncrypted` is opaque ciphertext (SEC-6): this layer
 * never sees the plaintext secret and must never log the row.
 */
export async function insertWebhook(
  exec: Executor,
  input: {
    webhookId: string;
    formId: FormId;
    url: string;
    secretEncrypted: string;
    active?: boolean;
  },
): Promise<WebhookRow> {
  const [row] = await exec
    .insert(webhooks)
    .values({
      webhookId: input.webhookId,
      formId: input.formId,
      url: input.url,
      secretEncrypted: input.secretEncrypted,
      ...(input.active === undefined ? {} : { active: input.active }),
    })
    .returning();
  return row!;
}

/** List every webhook configured for a form, active and inactive, newest first. */
export async function listWebhooks(exec: Executor, formId: FormId): Promise<WebhookRow[]> {
  return exec
    .select()
    .from(webhooks)
    .where(eq(webhooks.formId, formId))
    .orderBy(desc(webhooks.createdAt));
}

/** Read one webhook by id, scoped to its form, or `undefined`. */
export async function getWebhook(
  exec: Executor,
  formId: FormId,
  webhookId: string,
): Promise<WebhookRow | undefined> {
  const [row] = await exec
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.webhookId, webhookId), eq(webhooks.formId, formId)))
    .limit(1);
  return row;
}

/**
 * Update a webhook's mutable fields; only the provided ones change. Scoped to the form so
 * a stray id cannot mutate another form's config.
 */
export async function updateWebhook(
  exec: Executor,
  formId: FormId,
  webhookId: string,
  patch: {
    url?: string;
    secretEncrypted?: string;
    active?: boolean;
    deactivatedAt?: Date | null;
    now: Date;
  },
): Promise<WebhookRow | undefined> {
  const [row] = await exec
    .update(webhooks)
    .set({
      ...(patch.url === undefined ? {} : { url: patch.url }),
      ...(patch.secretEncrypted === undefined ? {} : { secretEncrypted: patch.secretEncrypted }),
      ...(patch.active === undefined ? {} : { active: patch.active }),
      ...(patch.deactivatedAt === undefined ? {} : { deactivatedAt: patch.deactivatedAt }),
      updatedAt: patch.now,
    })
    .where(and(eq(webhooks.webhookId, webhookId), eq(webhooks.formId, formId)))
    .returning();
  return row;
}

/**
 * Soft-deactivate a webhook without deleting the row, so its delivery history survives.
 * A second deactivate re-stamps.
 */
export async function deactivateWebhook(
  exec: Executor,
  formId: FormId,
  webhookId: string,
  now: Date,
): Promise<WebhookRow | undefined> {
  const [row] = await exec
    .update(webhooks)
    .set({ active: false, deactivatedAt: now, updatedAt: now })
    .where(and(eq(webhooks.webhookId, webhookId), eq(webhooks.formId, formId)))
    .returning();
  return row;
}
