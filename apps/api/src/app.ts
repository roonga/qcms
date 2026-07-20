/**
 * The API composition root (task 017; ARCHITECTURE §5.1–5.2).
 *
 * `createApp(deps, flags)` assembles the Hono application every slice mounts
 * into: cross-cutting middleware (error envelope, request logging, body limit),
 * the always-on health/ready routes, and the flag-gated route groups. There is
 * no DI container and no pipeline framework — middleware is ordinary Hono
 * middleware and dependencies arrive as the explicit `deps` object.
 *
 * **Mount flags are a build-time isolation guarantee (ADR-09).** A group that
 * is not mounted has *no routes registered* — a request to an admin path in a
 * public-only process is a plain 404, not a 403. Admin simply does not exist
 * there.
 *
 * Feature slices (018–026) are not defined here; they are `SliceRegistrar`s the
 * server entry collects into the surface buckets and passes via `groups`. 017
 * owns the contract, not the slices — so `createApp` with no `groups` composes
 * an app with just health/ready plus (empty) guarded surfaces, which is exactly
 * what the middleware/mount tests exercise.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import type { MountFlags } from "./config.js";
import type { Deps } from "./deps.js";
import { errorEnvelope } from "./middleware/error-envelope.js";
import { internalToken } from "./middleware/internal-token.js";
import { requestLogger } from "./middleware/request-logger.js";
import type { ApiEnv } from "./openapi.js";
import { registerHealthRoutes } from "./routes/health.js";

/**
 * A slice's registration function: given its group router and `deps`, it
 * declares its `createRoute` routes. This is the seam 018–026 implement.
 */
export type SliceRegistrar = (group: OpenAPIHono<ApiEnv>, deps: Deps) => void;

/** Route groups per surface; only groups whose flag is set are mounted. */
export interface RouteGroups {
  readonly public?: readonly SliceRegistrar[];
  readonly internal?: readonly SliceRegistrar[];
  readonly admin?: readonly SliceRegistrar[];
}

/** Mount prefixes per surface (admin isolated under `/admin`, ARCHITECTURE §5.1). */
const MOUNT_PREFIX = {
  public: "/",
  internal: "/internal",
  admin: "/admin",
} as const;

export interface CreateAppOptions {
  readonly groups?: RouteGroups;
}

/**
 * Build the API application for the given process shape. Pure over its inputs:
 * no environment reads, no schedulers, no port binding (those live in
 * `serve.ts`), so tests compose apps freely with `app.request(...)`.
 */
export function createApp(
  deps: Deps,
  flags: MountFlags,
  options: CreateAppOptions = {},
): OpenAPIHono<ApiEnv> {
  const app = new OpenAPIHono<ApiEnv>();

  // Uniform error rendering for everything below.
  app.onError(errorEnvelope(deps));

  // Correlation id + structured request log wraps every request.
  app.use("*", requestLogger(deps));

  // Request body size cap (SEC-9); over the limit → 413 via the envelope.
  app.use("*", bodyLimit({ maxSize: deps.config.bodyLimitBytes }));

  // Liveness/readiness: every shape, no credential.
  registerHealthRoutes(app, deps);

  const groups = options.groups ?? {};

  // Each mounted surface is guarded by the internal service token (SEC-4) and
  // populated by its slice registrars. Not mounting a surface means its routes
  // do not exist (ADR-09).
  const mount = (
    enabled: boolean,
    prefix: string,
    registrars: readonly SliceRegistrar[] | undefined,
  ): void => {
    if (!enabled) return;
    const group = new OpenAPIHono<ApiEnv>();
    group.use("*", internalToken(deps));
    for (const register of registrars ?? []) {
      register(group, deps);
    }
    app.route(prefix, group);
  };

  mount(flags.public, MOUNT_PREFIX.public, groups.public);
  mount(flags.internal, MOUNT_PREFIX.internal, groups.internal);
  mount(flags.admin, MOUNT_PREFIX.admin, groups.admin);

  return app;
}
