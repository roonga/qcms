import type { RouteGroups } from "./app.js";
import { registerAdminAuthProxy } from "./features/auth/route.js";
import { registerFormsAssist } from "./features/forms/assist/route.js";
import { registerForms } from "./features/forms/route.js";
import { registerLinks } from "./features/links/route.js";
import { registerMembership } from "./features/membership/route.js";
import { registerOperations } from "./features/operations/route.js";
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
 * `anonymous` is mounted only on `prod`, so other surfaces answer `404` (SEC-14). In
 * `admin`, `registerAdminAuth` goes first so the session gate refuses before the
 * environment name matters, then `registerRequestEnvironment`. `auth` sits outside the group.
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
    // Operations discovery: what a response-only caller needs to find its own forms,
    // which `GET /admin/forms` cannot serve without widening `form: read`.
    registerOperations,
    registerOutboxOps,
  ],
  auth: [registerAdminAuthProxy],
};
