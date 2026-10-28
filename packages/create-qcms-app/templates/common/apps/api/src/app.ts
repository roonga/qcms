import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import type { MountFlags } from "./config.js";
import type { Deps } from "./deps.js";
import { PROD_ENVIRONMENT } from "./environments.js";
import { errorEnvelope } from "./middleware/error-envelope.js";
import { internalToken } from "./middleware/internal-token.js";
import { requestLogger } from "./middleware/request-logger.js";
import { fixedEnvironment } from "./middleware/request-environment.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { validationErrorHook } from "./middleware/validation-hook.js";
import type { ApiEnv } from "./openapi.js";
import { registerHealthRoutes } from "./routes/health.js";

export type SliceRegistrar = (group: OpenAPIHono<ApiEnv>, deps: Deps) => void;

export interface RouteGroups {
  readonly respondent?: readonly SliceRegistrar[];
  readonly anonymous?: readonly SliceRegistrar[];
  readonly internal?: readonly SliceRegistrar[];
  readonly admin?: readonly SliceRegistrar[];
  /** Separate from `admin` because it issues the admin session, so it cannot sit behind the admin-session gate. */
  readonly auth?: readonly SliceRegistrar[];
}

// `/api/auth` must match the better-auth instance's `basePath`.
const MOUNT_PREFIX = {
  public: "/",
  internal: "/internal",
  admin: "/admin",
  auth: "/api/auth",
} as const;

export function environmentPrefix(environment: string): string {
  return environment === PROD_ENVIRONMENT ? MOUNT_PREFIX.public : `/${environment}`;
}

export interface CreateAppOptions {
  readonly groups?: RouteGroups;
}

export function createApp(
  deps: Deps,
  flags: MountFlags,
  options: CreateAppOptions = {},
): OpenAPIHono<ApiEnv> {
  // Set at each construction site rather than relying on the library's parent-app
  // lookup, which is a private field only linked once a group is mounted.
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: validationErrorHook });

  app.onError(errorEnvelope(deps));

  // Must sit above the request logger so the correlation id has a span to attach to.
  // Header capture is left unset on purpose: SEC-13 keeps credentials out of every signal.
  app.use("*", httpInstrumentationMiddleware());

  app.use("*", requestLogger(deps));

  app.use("*", securityHeaders());

  app.use("*", bodyLimit({ maxSize: deps.config.bodyLimitBytes }));

  registerHealthRoutes(app, deps);

  const groups = options.groups ?? {};

  // Not mounting a surface means its routes do not exist (ADR-09).
  const mount = (
    enabled: boolean,
    prefix: string,
    registrars: readonly SliceRegistrar[] | undefined,
    environment?: string,
  ): void => {
    if (!enabled) return;
    const group = new OpenAPIHono<ApiEnv>({ defaultHook: validationErrorHook });
    group.use("*", internalToken(deps));
    // The group a request was served by is its environment, so nothing a respondent
    // sends can change it.
    if (environment !== undefined) group.use("*", fixedEnvironment(environment));
    for (const register of registrars ?? []) {
      register(group, deps);
    }
    app.route(prefix, group);
  };

  mount(flags.public, MOUNT_PREFIX.public, groups.respondent, PROD_ENVIRONMENT);
  mount(flags.public, MOUNT_PREFIX.public, groups.anonymous, PROD_ENVIRONMENT);
  // The anonymous group's absence from every non-prod surface is what makes SEC-14
  // structural rather than a handler check.
  for (const environment of flags.environments ?? []) {
    mount(true, environmentPrefix(environment), groups.respondent, environment);
  }
  mount(flags.internal, MOUNT_PREFIX.internal, groups.internal);
  mount(flags.admin, MOUNT_PREFIX.admin, groups.admin);
  // Unauthenticated in the user sense, so the SEC-4 internal token `mount` installs is
  // what keeps these endpoints off any public network.
  mount(flags.admin, MOUNT_PREFIX.auth, groups.auth);

  return app;
}
