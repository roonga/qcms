/**
 * The **control plane** (ADR-40, Q20): one copy, in the `control` schema.
 *
 * Forms, versions, questions, links, releases, the live environment set, admin
 * identity and the workspace tables. Every table here is declared on
 * {@link ../schemas.js#controlSchema}, so Drizzle emits it schema-qualified and the
 * plane is unambiguous whatever a connection's `search_path` is.
 *
 * The other half of the split is `../data/index.ts`. **Their table-name sets must stay
 * disjoint**: the search path is `data_<env>, control` with the data plane first, so a
 * name declared in both would resolve to the environment's copy with no error, no
 * warning and no way to notice. `scripts/check-schema-disjoint.mjs` asserts the
 * intersection is empty and runs in `check:all`; keeping each set declared in exactly
 * one module is what makes that check cheap rather than a second hand-kept list.
 */

import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

// The schema objects and name derivations. Re-exported from HERE rather than from the
// flat index, so `drizzle.config.ts` - which points at this module alone - sees the
// `pgSchema` object and emits `CREATE SCHEMA "control"` at the head of the baseline.
export * from "../schemas.js";
export * from "./enums.js";
export * from "./questions.js";
export * from "./forms.js";
export * from "./secure-links.js";
export * from "./environments.js";
export * from "./auth.js";
export * from "./two-factor-resets.js";

import * as environmentsModule from "./environments.js";
import * as authModule from "./auth.js";
import * as formsModule from "./forms.js";
import * as questionsModule from "./questions.js";
import * as secureLinksModule from "./secure-links.js";
import * as twoFactorResetsModule from "./two-factor-resets.js";

/** Every Drizzle table object this module declares, in declaration order. */
const CONTROL_TABLE_OBJECTS: readonly PgTable[] = [
  questionsModule.questions,
  questionsModule.questionVersions,
  formsModule.forms,
  formsModule.formDrafts,
  formsModule.formVersions,
  secureLinksModule.secureLinks,
  environmentsModule.environments,
  authModule.authUser,
  authModule.authSession,
  authModule.authAccount,
  authModule.authVerification,
  authModule.authTwoFactor,
  authModule.authOrganization,
  authModule.authMember,
  authModule.authInvitation,
  authModule.authTeam,
  authModule.authTeamMember,
  twoFactorResetsModule.twoFactorResets,
];

/**
 * Every table name in `control`, **derived** from the declarations above rather than
 * written out a second time.
 *
 * This is what `migrations.test.ts` compares the created set against per schema and
 * what the disjointness check intersects with the data plane's, so a table added to
 * this module joins both without anybody remembering to.
 */
export const CONTROL_TABLE_NAMES: readonly string[] = CONTROL_TABLE_OBJECTS.map((table) =>
  getTableName(table),
);
