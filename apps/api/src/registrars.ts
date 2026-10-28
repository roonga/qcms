/**
 * The canonical slice-registrar buckets (task 027; the composition-root seam).
 *
 * `serve.ts` (the process entry) and the derived artifacts that must reflect the
 * *exact same* mounted surface - the 027 end-to-end suite and the generated
 * OpenAPI documents - all read the route groups from here, so there is one
 * source of truth for "what the API mounts". Adding a slice to a bucket here
 * makes it appear in the running server, the e2e composition, and the OpenAPI
 * document in lockstep; nothing can silently drift.
 *
 * This module registers *no* routes and reads *no* environment - it is a static
 * list of the `SliceRegistrar`s per surface. `createApp(deps, flags, { groups })`
 * is what actually mounts them for a given process shape.
 */

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
 * Slice registrars per surface (the enterprise topology, ARCHITECTURE §5.1):
 * the respondent-facing loop is per environment; authoring, response ops, and webhook
 * config are admin. The internal bucket carries no slices at launch.
 *
 * **`respondent` is mounted once per environment and `anonymous` only on `prod`**
 * (ADR-40, Q21, SEC-14, task 066). That is the whole of criterion 3: a non-prod
 * environment's surface carries secure-link entry, the session status read, serving a
 * step and submitting, and carries **no form-slug door at all**, so
 * `POST /test/sessions` with a form slug is a `404` rather than a handler's `403`.
 * `app.ts` is where the per-environment mount happens.
 *
 * `registerAdminAuth` MUST be first in `admin`: it installs the admin-session
 * gate every admin route below sits behind (021; 031 swaps the stub for real
 * better-auth verification). `registerRequestEnvironment` is second, because the Q6
 * switcher's environment is what every admin slice below reads its per-environment data
 * through (ADR-40, task 065) and an unauthenticated request should be refused by the
 * gate rather than by the name it sent.
 *
 * The `auth` bucket is the admin's identity provider (task 056), mounted on
 * `/api/auth` with the admin surface but deliberately outside the admin group: it is
 * what issues the session the admin group's gate then verifies, so it cannot sit
 * behind that gate. `app.ts` still puts the SEC-4 channel token in front of it.
 */
export const appGroups: RouteGroups = {
  respondent: [registerLinkEntry, registerSessionStatus, registerServeStep, registerSubmit],
  anonymous: [registerAnonymousEntry],
  internal: [],
  admin: [
    registerAdminAuth,
    registerRequestEnvironment,
    // 069: the grant check (SEC-3, ADR-41). Third, and the order is the reasoning: an
    // unauthenticated request is refused by the session gate rather than by a grant it
    // does not hold, and an act's environment has to be resolved before it can be
    // authorised for one. Every admin slice below sits behind it, and an admin route
    // with no row in `features/membership/route-policy.ts` is refused rather than served.
    registerGrantCheck,
    registerQuestions,
    registerForms,
    // 041: registers nothing when QCMS_FLAG_AGENT_AUTHORING=none (routes absent).
    registerFormsAssist,
    registerAdminResponses,
    registerReleases,
    // 068: the workspace container - the list, the one creation path, the shared-library
    // switch, the archive and the two ownership moves. It grants nothing; the membership
    // and grant endpoints are task 069's.
    registerWorkspaces,
    // 069: the membership surface - the capability answer, the membership list, the
    // access groups and their holders, the two per-workspace switches and the SEC-15
    // audit read. These are the **only** grant write path (Q45).
    registerMembership,
    registerLinks,
    registerWebhooks,
    // 1174: operations discovery (Q87). The authorised read model a response-only caller
    // needs to find its own forms at all, which `GET /admin/forms` cannot serve without
    // widening `form: read` (G02).
    registerOperations,
    registerOutboxOps,
  ],
  auth: [registerAdminAuthProxy],
};
