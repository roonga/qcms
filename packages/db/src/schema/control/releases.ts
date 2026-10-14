import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { FormId } from "@roonga/qcms-core";

import { environments } from "./environments.js";
import { formVersions } from "./forms.js";

import { controlSchema } from "../schemas.js";

/**
 * The release record (ADR-40, task 065): **what is released to this environment**, in
 * place of "the newest published version".
 *
 * A form version is published once and shared by every environment (ADR-18). What
 * varies per environment is which published version is **released** there, and a
 * release is a **record and never a copy**, which is what keeps `formId`, `questionId`
 * and version numbers continuous across environments (R1, R6, ADR-02, ADR-18).
 * Promotion writes a row here and copies nothing.
 *
 * **One append-only row per release.** The currently released version of a form in an
 * environment is the newest row for that pair and nothing else decides it. Append-only
 * is enforced at the database by `form_releases_reject_update` and
 * `form_releases_reject_delete`, the same mechanism `form_versions_reject_update`
 * already uses one table over: the history is the audit answer to "what was serving in
 * `prod` on that date, and who put it there", and an audit row the serving credential
 * can rewrite answers nothing.
 *
 * **Rollback is a release of an earlier version and there is no second mechanism.**
 * Nothing is reverted, undone or deleted: an administrator releases a version that
 * environment served before, a new row records it, and sessions already open stay on the
 * version they started (ADR-07, invariant I4). Whether a row *is* a rollback is
 * **derived** from the row and its predecessor by `releaseHistory` in
 * `queries/releases.ts` rather than stored, because a flag an administrator types is a
 * flag that can disagree with the versions beside it.
 *
 * **No backfill** (Q22): green field means there is no already-published form to write a
 * first release row for, so the first row any form gets is written by a real release.
 */
export const formReleases = controlSchema.table(
  "form_releases",
  {
    /** The form this release is of. */
    formId: text("form_id").$type<FormId>().notNull(),
    /**
     * The environment the version is released **to**; a `control.environments` name.
     *
     * No ordering requirement (Q4): a hotfix released straight to `prod` is allowed and
     * is recorded as such, with {@link formReleases.fromEnvironment} null.
     */
    environment: text("environment").notNull(),
    /** The published version released, which exists in `control.form_versions` already. */
    version: integer("version").notNull(),
    /**
     * This release's place in the form's history **in this environment**, 1-based and
     * assigned by `insertFormRelease` with the scalar subquery `insertFormVersion`
     * already uses for a version number.
     *
     * It is the primary key's third column rather than a surrogate id, and it is what
     * makes two separate readings cheap and exact:
     *
     *   - **the current release** is `max(sequence)` for the pair, so "the newest row"
     *     needs no timestamp comparison and no tie-break. Two releases that landed in
     *     the same microsecond would be indistinguishable ordered by `released_at`, and
     *     the one thing a release history may not be is ambiguous about which version
     *     is serving.
     *   - **the row before this one** is `sequence - 1`, which is the whole input to the
     *     rollback derivation.
     */
    sequence: integer("sequence").notNull(),
    /**
     * The environment this version was promoted **from**, or null when there was none
     * (Q4): a first release, or a hotfix released straight into its target.
     *
     * It records the path rather than authorising it. Nothing here requires a version to
     * have reached `test` before `prod`, because that requirement would be worked around
     * on the day it mattered most.
     */
    fromEnvironment: text("from_environment"),
    /**
     * The administrator who released it: a better-auth `control.user` id.
     *
     * **Deliberately no foreign key into `user`**, for the reason
     * `data_<env>.erasure_tombstones` has none either: this row is the audit answer to
     * "who put that version into `prod`", and an audit row that a later account deletion
     * could cascade or block is an audit row that answers the question only while it is
     * convenient. The id is recorded; the account it names is somebody else's lifecycle.
     */
    releasedBy: text("released_by").notNull(),
    /**
     * The approval recorded with the release, or null when none was required.
     *
     * **Present from task 065 and written by task 070** (Q51): the two-person rule for
     * `prod` is 070's, a release there being one act by a `forms.approver` who is not the
     * account that published the version. The column exists here because the approval is
     * recorded **on the release record**, which is what makes it auditable rather than
     * procedural (ADR-41), and a column a later task adds to an append-only table cannot
     * be filled in for the rows written before it.
     */
    approvedBy: text("approved_by"),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.formId, t.environment, t.sequence] }),
    // The version released is a published version of **this** form, enforced by the key
    // rather than by the handler: a release of a version that does not exist, or of
    // another form's version number, is the one way this table could claim something was
    // serving that never could have been.
    foreignKey({
      name: "form_releases_form_version_fk",
      columns: [t.formId, t.version],
      foreignColumns: [formVersions.formId, formVersions.version],
    }),
    foreignKey({
      name: "form_releases_environment_fk",
      columns: [t.environment],
      foreignColumns: [environments.name],
    }),
    foreignKey({
      name: "form_releases_from_environment_fk",
      columns: [t.fromEnvironment],
      foreignColumns: [environments.name],
    }),
    check("form_releases_version_positive", sql`${t.version} > 0`),
    check("form_releases_sequence_positive", sql`${t.sequence} > 0`),
    // A promotion comes from somewhere else. `from_environment = environment` would
    // read as "promoted from itself", which is not a path and not a first release
    // either; null is how "there was no source" is spelled (Q4).
    check(
      "form_releases_from_other_environment",
      sql`${t.fromEnvironment} is null or ${t.fromEnvironment} <> ${t.environment}`,
    ),
    // "What is released where", across forms, which is the admin's environment screen
    // and is the one read whose leading column is the environment rather than the form.
    // Everything keyed by form is served by the primary key.
    index("form_releases_environment_idx").on(t.environment, t.formId, t.sequence.desc()),
  ],
);
