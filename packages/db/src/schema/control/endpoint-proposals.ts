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
 * A proposed change to a `prod` webhook endpoint, held pending until a second account
 * confirms it (ADR-41's release rule, Q30, Q51; task 070).
 *
 * # Why the endpoint mechanism has a table and the release mechanism does not
 *
 * Q51 gives the two-person rule **two shapes, and the difference is deliberate**. A release
 * names a version that already exists and can be judged in one look, so it is **one act**:
 * a `forms.approver` who is not the account that published the version releases it, and the
 * approval is recorded on the release row (ADR-40). An endpoint change is a **new value
 * somebody has to read before it is live**, so it is proposed, held here, and confirmed -
 * and nothing can be judged until the proposed value is written down somewhere that is not
 * the live configuration. This table is that somewhere.
 *
 * Collapsing the two into one mechanism for symmetry is the question issue #998 raised and
 * the Code Owner answered the other way.
 *
 * # Why it is in `control` and not in `data_<env>` beside the endpoint it proposes
 *
 * The endpoint row itself is per environment (`data_<env>.webhooks`, task 067), so the
 * obvious home for a proposed change to one is beside it. Two things rule that out:
 *
 *   - **The migration chain.** A data-plane table exists once per environment and the
 *     per-environment half of the baseline is a generator's output, checked in (ADR-18,
 *     Q41). Adding a table to that set changes migration 0000, and the chain has been
 *     append-only again since task 064 landed its re-baseline (Q67).
 *   - **The plane this act belongs to.** Proposing and confirming an endpoint change is an
 *     authenticated administrator's act on configuration, which is the control plane's,
 *     exactly as **minting** a secure link runs on the control pool while **redeeming** one
 *     runs on the environment pool (Q53). The credential that serves anonymous respondent
 *     traffic has no business writing a row here, and it holds no privilege on this table.
 *
 * So the proposal is control-plane state carrying the environment it is about, and the
 * **apply** is the one step that reaches `data_<env>.webhooks`, on that environment's own
 * pool. {@link webhookEndpointProposals.appliedAt} is what makes that two-pool step legible
 * rather than assumed: a confirmation whose apply did not land is a row saying
 * `confirmed_at` with `applied_at` still null, and the endpoint is **not** live. That is the
 * conservative direction for a control whose whole purpose is to stop production personal
 * data reaching a new URL: the failure a reader can see is "confirmed, not yet applied", and
 * never "live, and nobody recorded who agreed".
 *
 * # Not append-only, and why that is not a hole
 *
 * The rows here are **operational state with a lifecycle** - pending, then confirmed or
 * withdrawn - so unlike `form_releases` this table is updated in place and carries no
 * reject-update trigger. The audit answer does not live here: every propose, confirm and
 * withdraw writes its own append-only SEC-15 row (Q61), on a table no application role may
 * `UPDATE` or `DELETE`. This table says what is pending now; the audit says what happened.
 */
export const webhookEndpointProposals = controlSchema.table(
  "webhook_endpoint_proposals",
  {
    /** An opaque `wep_` id minted by the API, like `whk_` one plane over. */
    proposalId: text("proposal_id").primaryKey(),
    /** The form whose endpoint this proposes to change. */
    formId: text("form_id").$type<FormId>().notNull(),
    /**
     * The environment the change is for; a `control.environments` name.
     *
     * In practice always `prod`, because that is the only environment the rule gates (Q30,
     * finding 5), and the column is the environment's name rather than a flag so a reader
     * of a row never has to know that. **The confirm path compares this against the
     * environment the request was authorised for and refuses a mismatch**: a proposal for
     * `prod` confirmed by a request whose switcher said `test` would be authorised against
     * `test`, where a `forms.editor` suffices, which is precisely the bypass shape PR
     * #1061's review found.
     */
    environment: text("environment").notNull(),
    /**
     * The endpoint id the change is about.
     *
     * **Minted at propose time even for a `create`**, so the apply is idempotent by id: a
     * confirm whose apply has to be repeated writes the same `whk_` row rather than a second
     * endpoint.
     */
    webhookId: text("webhook_id").notNull(),
    /** Which of the three configure acts this is. */
    kind: text("kind").notNull(),
    /**
     * The proposed target URL, already checked against the SSRF policy at propose time, or
     * null where the act names no URL (a deactivation, or an update that only flips
     * `active`).
     *
     * SEC-14's per-environment egress allowlist stays the network backstop underneath this
     * whole mechanism, because an endpoint that should not have been set is still an
     * endpoint a firewall can refuse.
     */
    url: text("url"),
    /**
     * The proposed secret, as AES-256-GCM ciphertext under `QCMS_APP_KEY`, or null when the
     * act does not set one.
     *
     * The same column shape as `data_<env>.webhooks.secret_encrypted` and for the same
     * reason (SEC-6, SEC-8): the deliverer must recover the plaintext to sign, so a hash is
     * impossible. The plaintext is revealed to the proposer once, at propose time, and the
     * stored ciphertext is what the apply moves across. **The database never sees the
     * plaintext here either.**
     */
    secretEncrypted: text("secret_encrypted"),
    /** The proposed `active` flag, or null where the act does not change it. */
    active: boolean("active"),
    /** The account that proposed it: a better-auth `control.user` id, no foreign key. */
    proposedBy: text("proposed_by").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * The account that confirmed it, which is **never** {@link webhookEndpointProposals.proposedBy}
     * (Q51). Null while the proposal is pending.
     *
     * The refusal is the API's, because this is two accounts rather than two roles and a
     * CHECK comparing two columns would only catch the case the handler had already decided
     * to allow. The check below asserts the pair cannot be equal anyway, so a defect that
     * tried to write one is refused by the database as well.
     */
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    /** When the confirmed change reached `data_<env>.webhooks`. See the header. */
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }),
    /** The account that withdrew it, and when. Either account may withdraw. */
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
    // A proposal is confirmed or withdrawn, never both. Two columns rather than a status
    // enum because each carries an account and a time, and a status would need them anyway.
    check(
      "webhook_endpoint_proposals_one_outcome",
      sql`${t.confirmedAt} is null or ${t.withdrawnAt} is null`,
    ),
    // The two accounts the whole mechanism is about. The API refuses a self-confirmation
    // with a message; this refuses it as a write, so a second write path could not.
    check(
      "webhook_endpoint_proposals_second_account",
      sql`${t.confirmedBy} is null or ${t.confirmedBy} <> ${t.proposedBy}`,
    ),
    // Nothing is applied that nobody confirmed.
    check(
      "webhook_endpoint_proposals_applied_after_confirm",
      sql`${t.appliedAt} is null or ${t.confirmedAt} is not null`,
    ),
    // An outcome names the account that reached it.
    check(
      "webhook_endpoint_proposals_outcome_actor",
      sql`(${t.confirmedAt} is null) = (${t.confirmedBy} is null) and (${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`,
    ),
    /**
     * **One open proposal per endpoint per environment**, where open means *not yet applied
     * and not withdrawn*.
     *
     * Two open changes to the same endpoint would make "confirm this one" ambiguous: the
     * second confirmation would overwrite the first with a value its confirmer had read in a
     * different screen. A second endpoint in the same form is a different `webhook_id` and
     * is unaffected, which is why the key is the endpoint rather than the form.
     *
     * The predicate is **`applied_at is null`** rather than `confirmed_at is null`, and the
     * difference is the two-pool window one paragraph up: a confirmation whose endpoint
     * write did not land is confirmed and not applied, and it can still be resumed. If a
     * second proposal could be created and applied beside it, resuming the first would
     * overwrite the second with a value nobody had agreed to last. So a confirmed proposal
     * keeps the endpoint claimed until its apply lands or it is withdrawn.
     */
    uniqueIndex("webhook_endpoint_proposals_one_open")
      .on(t.environment, t.webhookId)
      .where(sql`applied_at is null and withdrawn_at is null`),
    // "What is pending for this form", which is the admin's screen and the one read whose
    // leading column is the form.
    index("webhook_endpoint_proposals_form_idx").on(t.formId, t.environment, t.proposedAt.desc()),
  ],
);

/** The three configure acts a proposal can carry. */
export const ENDPOINT_PROPOSAL_KINDS = ["create", "update", "deactivate"] as const;

/** One of {@link ENDPOINT_PROPOSAL_KINDS}. */
export type EndpointProposalKind = (typeof ENDPOINT_PROPOSAL_KINDS)[number];

/** The table name, for the migration's grant emitter. */
export const ENDPOINT_PROPOSALS_TABLE = "webhook_endpoint_proposals";
