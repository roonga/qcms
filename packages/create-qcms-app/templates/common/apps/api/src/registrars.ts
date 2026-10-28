import type { RouteGroups } from "./app.js";
import { registerAdminAuthProxy } from "./features/auth/route.js";
import { registerFormsAssist } from "./features/forms/assist/route.js";
import { registerForms } from "./features/forms/route.js";
import { registerLinks } from "./features/links/route.js";
import { registerMembership } from "./features/membership/route.js";
import { registerOutboxOps } from "./features/outbox/route.js";
import { registerQuestions } from "./features/questions/route.js";
import { registerReleases } from "./features/releases/route.js";
import { registerAdminResponses } from "./features/responses/admin/route.js";
import { registerServeStep } from "./features/responses/serve-step/route.js";
import {
  registerAnonymousEntry,
  registerLinkEntry,
  registerSessionStatus,
} from "./features/responses/start-session/route.js";
import { registerSubmit } from "./features/responses/submit/route.js";
import { registerWebhooks } from "./features/webhooks/route.js";
import { registerWorkspaces } from "./features/workspaces/route.js";
import { registerGrantCheck } from "./features/membership/middleware.js";
import { registerAdminAuth } from "./middleware/admin-auth.js";
import { registerRequestEnvironment } from "./middleware/request-environment.js";

/**
 * `anonymous` is mounted only on `prod`, so a non-prod surface has no form-slug door at
 * all and answers `404` rather than relying on a handler's `403` (SEC-14).
 *
 * Order in `admin` is load-bearing: `registerAdminAuth` first, so an unauthenticated
 * request is refused by the session gate rather than by the environment name it sent, and
 * `registerRequestEnvironment` second, because every slice below reads its per-environment
 * data through it.
 *
 * `auth` sits outside the admin group because it issues the session that group's gate
 * verifies, so it cannot sit behind that gate.
 */
export const appGroups: RouteGroups = {
  respondent: [registerLinkEntry, registerSessionStatus, registerServeStep, registerSubmit],
  anonymous: [registerAnonymousEntry],
  internal: [],
  admin: [
    registerAdminAuth,
    registerRequestEnvironment,
    // Third: an act's environment has to be resolved before it can be authorised for one.
    // An admin route with no row in `features/membership/route-policy.ts` is refused
    // rather than served (SEC-3).
    registerGrantCheck,
    registerQuestions,
    registerForms,
    registerFormsAssist,
    registerAdminResponses,
    registerReleases,
    registerWorkspaces,
    // The only grant write path.
    registerMembership,
    registerLinks,
    registerWebhooks,
    registerOutboxOps,
  ],
  auth: [registerAdminAuthProxy],
};
