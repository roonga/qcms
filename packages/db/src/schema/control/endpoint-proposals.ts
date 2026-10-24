import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { FormId } from "@roonga/qcms-core";

import { environments } from "./environments.js";
import { forms } from "./forms.js";

import { controlSchema } from "../schemas.js";

/**
 * A proposed change to a `prod` webhook endpoint, held until a second account confirms it
 * (ADR-41). The apply runs on the environment's own pool, so
 * {@link webhookEndpointProposals.appliedAt} is what says the endpoint is live: a row with
 * `confirmed_at` and a null `applied_at` is not.
 *
 * Rows are updated in place; the audit answer lives in the append-only SEC-15 rows every
 * propose, confirm and withdraw writes.
 */
export const webhookEndpointProposals = controlSchema.table(
  "webhook_endpoint_proposals",
  {
    proposalId: text("proposal_id").primaryKey(),
    formId: text("form_id").$type<FormId>().notNull(),
    /**
     * The confirm path compares this against the environment the request was authorised
     * for and refuses a mismatch: a `prod` proposal confirmed under a `test` request would
     * be authorised against `test`, where a `forms.editor` suffices.
     */
    environment: text("environment").notNull(),
    /**
     * Minted at propose time even for a `create`, so a repeated apply writes the same
     * `whk_` row rather than a second endpoint.
     */
    webhookId: text("webhook_id").notNull(),
    kind: text("kind").notNull(),
    /**
     * Already checked against the SSRF policy at propose time, or null where the act names
     * no URL. SEC-14's egress allowlist stays the network backstop underneath.
     */
    url: text("url"),
    /**
     * AES-256-GCM ciphertext under `QCMS_APP_KEY`. Encrypted rather than hashed because
     * the deliverer must recover the plaintext to sign (SEC-6, SEC-8); the database never
     * sees the plaintext.
     */
    secretEncrypted: text("secret_encrypted"),
    active: boolean("active"),
    proposedBy: text("proposed_by").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    /** When the confirmed change reached `data_<env>.webhooks`. */
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }),
    /** Either account may withdraw. */
    withdrawnBy: text("withdrawn_by"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    foreignKey({
      name: "webhook_endpoint_proposals_form_fk",
      columns: [t.formId],
      foreignColumns: [forms.formId],
    }),
    foreignKey({
      name: "webhook_endpoint_proposals_environment_fk",
      columns: [t.environment],
      foreignColumns: [environments.name],
    }),
    check("webhook_endpoint_proposals_kind", sql`${t.kind} in ('create', 'update', 'deactivate')`),
    // A confirmed proposal may still be withdrawn, which is what ends a row whose apply
    // never landed and would otherwise keep the endpoint claimed forever.
    check(
      "webhook_endpoint_proposals_one_outcome",
      sql`${t.appliedAt} is null or ${t.withdrawnAt} is null`,
    ),
    check(
      "webhook_endpoint_proposals_second_account",
      sql`${t.confirmedBy} is null or ${t.confirmedBy} <> ${t.proposedBy}`,
    ),
    check(
      "webhook_endpoint_proposals_applied_after_confirm",
      sql`${t.appliedAt} is null or ${t.confirmedAt} is not null`,
    ),
    check(
      "webhook_endpoint_proposals_outcome_actor",
      sql`(${t.confirmedAt} is null) = (${t.confirmedBy} is null) and (${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`,
    ),
    /**
     * One open proposal per endpoint per environment. The predicate is `applied_at is
     * null` rather than `confirmed_at is null`, so a confirmation whose endpoint write did
     * not land keeps the endpoint claimed and can still be resumed.
     */
    uniqueIndex("webhook_endpoint_proposals_one_open")
      .on(t.environment, t.webhookId)
      .where(sql`applied_at is null and withdrawn_at is null`),
    index("webhook_endpoint_proposals_form_idx").on(t.formId, t.environment, t.proposedAt.desc()),
  ],
);

/** The configure acts a proposal can carry. */
export const ENDPOINT_PROPOSAL_KINDS = ["create", "update", "deactivate"] as const;

/** One of {@link ENDPOINT_PROPOSAL_KINDS}. */
export type EndpointProposalKind = (typeof ENDPOINT_PROPOSAL_KINDS)[number];

/** The table name, for the migration's grant emitter. */
export const ENDPOINT_PROPOSALS_TABLE = "webhook_endpoint_proposals";
