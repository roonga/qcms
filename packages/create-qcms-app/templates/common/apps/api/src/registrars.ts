import type { RouteGroups } from "./app.js";
import { registerAccountClaim } from "./features/accounts/claim-route.js";
import { registerAccounts } from "./features/accounts/route.js";
import { registerAdminAuthProxy } from "./features/auth/route.js";
import { registerAgentProvenance } from "./features/agent/provenance-mount.js";
import { registerAgentChanges, registerFormsAssist } from "./features/agent/route.js";
import { registerForms } from "./features/forms/route.js";
import { registerLinks } from "./features/links/route.js";
import { registerLogoTakedown, registerLogos } from "./features/logos/route.js";
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
 * `anonymous` is mounted only on `prod`, so other surfaces answer `404`. In `admin`, `registerAdminAuth`
 * goes first so the session gate refuses before the environment name matters, then
 * `registerRequestEnvironment`. `auth` sits outside the group, because its routes issue the
 * session the gate reads.
 */
export const appGroups: RouteGroups = {
  respondent: [
    registerLinkEntry,
    registerSessionStatus,
    registerServeStep,
    registerSubmit,
    // On every environment's respondent surface, because a logo is served to whoever the
    // form is served to and takes no session of its own.
    registerLogos,
  ],
  anonymous: [registerAnonymousEntry],
  internal: [],
  admin: [
    registerAdminAuth,
    registerRequestEnvironment,
    // Third: an act's environment has to be resolved before it can be authorised for one. An admin route with no
    // row in `features/membership/route-policy.ts` is refused rather than served.
    registerGrantCheck,
    // Fourth: provenance is read from a request the policy has already authorised, so a token can only add an
    // audit row and never a right.
    registerAgentProvenance,
    registerQuestions,
    registerForms,
    registerFormsAssist,
    registerAgentChanges,
    registerAdminResponses,
    registerReleases,
    registerWorkspaces,
    // The one write on the site-wide logo store, and a Site administrator's alone.
    registerLogoTakedown,
    // The only grant write path.
    registerMembership,
    registerAccounts,
    registerLinks,
    registerWebhooks,
    // Operations discovery: what a response-only caller needs to find its own forms,
    // which `GET /admin/forms` cannot serve without widening `form: read`.
    registerOperations,
    registerOutboxOps,
  ],
  // The claim comes first: the proxy below answers 404 to every path that is not a
  // better-auth endpoint, so a registrar after it would never be reached.
  auth: [registerAccountClaim, registerAdminAuthProxy],
};
