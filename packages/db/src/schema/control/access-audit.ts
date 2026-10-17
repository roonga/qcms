import { sql } from "drizzle-orm";
import { check, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The access audit (SEC-15, ADR-41, task 069).
 *
 * One append-only row per act that touches response data or the grants that reach it:
 * every **read**, **export** and **erasure** of a response (Q31), every **grant** write
 * and every **revoke** (Q56), and every change to the seed **setting** (Q57, Q61). The
 * gap it closes is that every other control in `docs/SECURITY_DESIGN.md` governs
 * *whether* somebody may read a response and nothing records *that they did*.
 *
 * # The precedent shape, and the three properties borrowed from it
 *
 * `two_factor_resets` (issue #432) is the model, for three properties rather than one:
 *
 *   - **Append-only**, written by the act it records.
 *   - **No foreign key**, to the account, the workspace, the form or the environment.
 *     An audit row that cascades away with the thing it describes is not an audit row,
 *     and this task must **not** add such a key (`plan/environments-and-workspaces.md`,
 *     the note of 2026-09-29). The columns below are therefore values rather than
 *     references, and nothing in `migrations/` declares a key on them.
 *   - **Write privilege narrowed against the credential that serves traffic.** That is
 *     the migration's, not this module's: `INSERT` to every `qcms_app_<env>`, `SELECT`
 *     and `INSERT` to `qcms_app_control`, and `UPDATE` and `DELETE` revoked from every
 *     `qcms_app%` role (Q40 as widened by Q56).
 *
 * The privilege set is **not** `two_factor_resets`', and the difference is the point:
 * that table is migrate-only because a break-glass is an operator act, while this one is
 * written by the application on an ordinary request and so cannot be. What it keeps from
 * the precedent is append-only, no foreign key, and no `UPDATE` or `DELETE` for any
 * application role, which is the part that makes a row worth something.
 *
 * # Why there is no reject-update trigger beside the revoke
 *
 * `control.form_releases` has one, because the control role holds **DML** there and the
 * grant alone would let it rewrite history. Here the record's answer is the grant itself:
 * SEC-15 says "only `qcms_migrate` can alter an audit row", so `UPDATE` and `DELETE` are
 * revoked from every application role and a trigger would additionally refuse the
 * migration role, which is the one role the record names as able to. The immutability is
 * a privilege rather than a guard, deliberately, and `03-db-least-privilege.e2e.ts` is
 * what asserts it.
 *
 * # The environment role cannot verify what it writes
 *
 * A staff response read spans two pools: membership resolves on the **control** pool, and
 * the read plus its audit row commit on the **environment** pool, which holds no `SELECT`
 * on `user` or `member`. So `actor` and `workspaceId` arrive as values the writing role
 * cannot check. That is deliberate and is the same shape the precedent already has; the
 * API is where both values are established, before the write.
 *
 * # What it does not carry
 *
 * No answer value, no respondent identifier and no `LocalizedText` content, in any
 * column, `detail` included. The row records the **act**, not its subject matter, so the
 * audit of a read never becomes a second copy of what was read - the reasoning ADR-17's
 * tombstone uses one table over, existence without content.
 */

/**
 * The six kinds (Q31, widened by Q56 and Q61).
 *
 * Read, export and erasure answer "who looked at this". **Grant** and **revoke** answer
 * "who made it possible", and without them the first question has an unrecorded step in
 * front of it. **`setting`** is the sixth: turning `seedNewEditorsWithTestData` on is
 * none of the other five and is an owner's deliberate act on personal data (Q57).
 *
 * A `text` column with a CHECK rather than a Postgres enum, for the reason Q54 gives for
 * keeping the two data-plane enums single: a seventh kind here is a one-line CHECK change
 * rather than an `ALTER TYPE`, and nothing about this vocabulary crosses a schema
 * boundary the way `session_status` does.
 */
export const ACCESS_AUDIT_KINDS = [
  "read",
  "export",
  "erasure",
  "grant",
  "revoke",
  "setting",
] as const;

/** One of SEC-15's six kinds. */
export type AccessAuditKind = (typeof ACCESS_AUDIT_KINDS)[number];

/** The name of the CHECK that pins {@link ACCESS_AUDIT_KINDS} at the database. */
export const ACCESS_AUDIT_KIND_CHECK = "access_audit_kind";

/** The table name, for the grant emitters and the migration that creates it. */
export const ACCESS_AUDIT_TABLE = "access_audit";

export const accessAudit = controlSchema.table(
  ACCESS_AUDIT_TABLE,
  {
    /**
     * A surrogate key, so a row is addressable. It is **not** one of SEC-15's seven
     * fields: those are the seven below, and the criteria that count them count those.
     */
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The administrator's account (`user.id`), or the IdP subject where single sign-on is
     * in use. Not a foreign key; see the header.
     */
    actor: text("actor").notNull(),
    /** The workspace the act was performed in, or whose form owns the data read. */
    workspaceId: text("workspace_id").notNull(),
    /**
     * The environment whose data was read.
     *
     * **Empty on a grant, a revoke or a setting row unless the act names one** (Q61): a
     * grant scoped to `prod` names an environment and a grant scoped to `all` does not.
     * The scope itself is not lost - it moves to `detail`.
     */
    environment: text("environment"),
    /** The form. Empty on a grant, a revoke or a setting row unless the act names one. */
    formId: text("form_id"),
    /** One of {@link ACCESS_AUDIT_KINDS}. */
    kind: text("kind").notNull(),
    /** When. */
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * The scope of a grant or a revoke (`all` or the form list), or a setting's name and
     * its new value. Empty on a read, an export and an erasure (Q61).
     *
     * Free text rather than JSON, because it is read by a person: an owner looking at
     * their own workspace's audit, and an incident reviewer a year later. Nothing
     * branches on it, so a structured column would buy a parser nobody calls.
     */
    detail: text("detail"),
  },
  (t) => [
    /**
     * The kind vocabulary, at the database.
     *
     * A row carrying a seventh kind would be a row no reader knows how to read, and the
     * writers are two different roles on two different pools - so the vocabulary is
     * pinned where both of them meet rather than in each one's own helper.
     */
    check(
      ACCESS_AUDIT_KIND_CHECK,
      sql`${t.kind} in ('read', 'export', 'erasure', 'grant', 'revoke', 'setting')`,
    ),
  ],
);
