import { sql } from "drizzle-orm";
import {
  boolean,
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
 * The per-environment release record.
 *
 * The version released to an environment is the newest row for the (form, environment)
 * pair, and nothing else decides it. A release is a record and never a copy, so version
 * numbers stay continuous across environments (R1, R6, ADR-18).
 *
 * Append-only, enforced by `form_releases_reject_update` and
 * `form_releases_reject_delete`: an audit row the serving credential can rewrite answers
 * nothing. Rollback is a release of an earlier version and there is no second mechanism.
 */
export const formReleases = controlSchema.table(
  "form_releases",
  {
    formId: text("form_id").$type<FormId>().notNull(),
    environment: text("environment").notNull(),
    version: integer("version").notNull(),
    /**
     * The current release is `max(sequence)` and its predecessor is `sequence - 1`. Two
     * releases in the same microsecond would be indistinguishable ordered by `released_at`,
     * and which version is serving may not be ambiguous.
     */
    sequence: integer("sequence").notNull(),
    /**
     * Null when there was none: a first release, or a hotfix released straight into its
     * target. It records the path rather than authorising it.
     */
    fromEnvironment: text("from_environment"),
    /** No foreign key, so a later account deletion cannot cascade or block the record. */
    releasedBy: text("released_by").notNull(),
    approvedBy: text("approved_by"),
    /**
     * A close and a reopen append a row carrying the released version forward, so intake
     * stopping and starting never disturbs the version a respondent is pinned to, and a
     * release does not reopen a closed environment. In-flight sessions are untouched
     * either way (ADR-07 invariant I4).
     */
    closed: boolean("closed").notNull().default(false),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.formId, t.environment, t.sequence] }),
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
    check(
      "form_releases_from_other_environment",
      sql`${t.fromEnvironment} is null or ${t.fromEnvironment} <> ${t.environment}`,
    ),
    index("form_releases_environment_idx").on(t.environment, t.formId, t.sequence.desc()),
  ],
);
