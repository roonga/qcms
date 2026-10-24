/**
 * Table names here must stay disjoint from `../data/index.ts`: the search path is
 * `data_<env>, control`, so a name in both resolves to the environment's copy with no
 * error.
 */

import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

// Re-exported here rather than from the flat index, so `drizzle.config.ts` sees the
// `pgSchema` object and emits `CREATE SCHEMA "control"` at the head of the baseline.
export * from "../schemas.js";
export * from "./enums.js";
export * from "./questions.js";
export * from "./forms.js";
export * from "./secure-links.js";
export * from "./environments.js";
export * from "./releases.js";
export * from "./auth.js";
export * from "./two-factor-resets.js";
export * from "./access-audit.js";
export * from "./endpoint-proposals.js";

import * as environmentsModule from "./environments.js";
import * as authModule from "./auth.js";
import * as formsModule from "./forms.js";
import * as questionsModule from "./questions.js";
import * as releasesModule from "./releases.js";
import * as secureLinksModule from "./secure-links.js";
import * as twoFactorResetsModule from "./two-factor-resets.js";
import * as accessAuditModule from "./access-audit.js";
import * as endpointProposalsModule from "./endpoint-proposals.js";

const CONTROL_TABLE_OBJECTS: readonly PgTable[] = [
  questionsModule.questions,
  questionsModule.questionVersions,
  formsModule.forms,
  formsModule.formDrafts,
  formsModule.formVersions,
  secureLinksModule.secureLinks,
  environmentsModule.environments,
  releasesModule.formReleases,
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
  accessAuditModule.accessAudit,
  endpointProposalsModule.webhookEndpointProposals,
];

/** Every table name in `control`. */
export const CONTROL_TABLE_NAMES: readonly string[] = CONTROL_TABLE_OBJECTS.map((table) =>
  getTableName(table),
);
