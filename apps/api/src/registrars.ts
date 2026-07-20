/**
 * The canonical slice-registrar buckets (task 027; the composition-root seam).
 *
 * `serve.ts` (the process entry) and the derived artifacts that must reflect the
 * *exact same* mounted surface — the 027 end-to-end suite and the generated
 * OpenAPI documents — all read the route groups from here, so there is one
 * source of truth for "what the API mounts". Adding a slice to a bucket here
 * makes it appear in the running server, the e2e composition, and the OpenAPI
 * document in lockstep; nothing can silently drift.
 *
 * This module registers *no* routes and reads *no* environment — it is a static
 * list of the `SliceRegistrar`s per surface. `createApp(deps, flags, { groups })`
 * is what actually mounts them for a given process shape.
 */

import type { RouteGroups } from "./app.js";
import { registerForms } from "./features/forms/route.js";
import { registerLinks } from "./features/links/route.js";
import { registerOutboxOps } from "./features/outbox/route.js";
import { registerQuestions } from "./features/questions/route.js";
import { registerAdminResponses } from "./features/responses/admin/route.js";
import { registerServeStep } from "./features/responses/serve-step/route.js";
import { registerStartSession } from "./features/responses/start-session/route.js";
import { registerSubmit } from "./features/responses/submit/route.js";
import { registerWebhooks } from "./features/webhooks/route.js";
import { registerAdminAuth } from "./middleware/admin-auth.js";

/**
 * Slice registrars per surface (the enterprise topology, ARCHITECTURE §5.1):
 * the respondent-facing loop is public; authoring, response ops, and webhook
 * config are admin. The internal bucket carries no slices at launch.
 *
 * `registerAdminAuth` MUST be first in `admin`: it installs the admin-session
 * gate every admin route below sits behind (021; 031 swaps the stub for real
 * better-auth verification).
 */
export const appGroups: RouteGroups = {
  public: [registerStartSession, registerServeStep, registerSubmit],
  internal: [],
  admin: [
    registerAdminAuth,
    registerQuestions,
    registerForms,
    registerAdminResponses,
    registerLinks,
    registerWebhooks,
    registerOutboxOps,
  ],
};
