/**
 * The API composition root (task 017; ARCHITECTURE §5.1–5.2).
 *
 * `createApp(deps, flags)` assembles the Hono application every slice mounts
 * into: cross-cutting middleware (error envelope, request logging, body limit),
 * the always-on health/ready routes, and the flag-gated route groups. There is
 * no DI container and no pipeline framework - middleware is ordinary Hono
 * middleware and dependencies arrive as the explicit `deps` object.
 *
 * **Mount flags are a build-time isolation guarantee (ADR-09).** A group that
 * is not mounted has *no routes registered* - a request to an admin path in a
 * public-only process is a plain 404, not a 403. Admin simply does not exist
 * there.
 *
 * **Since task 066 the respondent surface is one group per environment** (ADR-40, Q21,
 * SEC-14), and anonymous entry is a group of its own that only `prod` mounts. Those two
 * facts are what turn SEC-14's "no anonymous entry to a non-prod environment" from a
 * handler refusal into the `404` ADR-09 promises: `/test/sessions` with a form slug does
 * not exist, rather than existing and refusing. ADR-09's Note is amended in this task's
 * PR because the count of groups riding the flags changes with it.
 *
 * Feature slices (018–026) are not defined here; they are `SliceRegistrar`s the
 * server entry collects into the surface buckets and passes via `groups`. 017
 * owns the contract, not the slices - so `createApp` with no `groups` composes
 * an app with just health/ready plus (empty) guarded surfaces, which is exactly
 * what the middleware/mount tests exercise.
 */

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

/**
 * A slice's registration function: given its group router and `deps`, it
 * declares its `createRoute` routes. This is the seam 018–026 implement.
 */
export type SliceRegistrar = (group: OpenAPIHono<ApiEnv>, deps: Deps) => void;

/** Route groups per surface; only groups whose flag is set are mounted. */
export interface RouteGroups {
  /**
   * The respondent loop: secure-link entry, the session's status read, serving a step
   * and submitting. Mounted **once per environment** (Q21, task 066) - at `/` for
   * `prod` when `flags.public` is set, and at `/<env>` for each of
   * `flags.environments`.
   *
   * Every route in it is served from its group's own environment's pool, which the
   * mount installs (`fixedEnvironment`), so a handler cannot read the wrong
   * environment's data however the request arrived.
   */
  readonly respondent?: readonly SliceRegistrar[];
  /**
   * **Anonymous entry** (`POST /sessions` with a form slug), which is `prod`'s and
   * `prod`'s alone (SEC-14, ADR-09, task 066).
   *
   * Its own group because that is the only way the claim can be structural. Anonymous
   * and secure-link entry were one route discriminated by a body refine, so "there is
   * no anonymous entry to `test`" could only have been a handler's `403`; split, the
   * non-prod mount simply does not register this group and the address is a plain
   * `404`. That is the amendment to ADR-09's Note this task lands.
   */
  readonly anonymous?: readonly SliceRegistrar[];
  readonly internal?: readonly SliceRegistrar[];
  readonly admin?: readonly SliceRegistrar[];
  /**
   * The admin's identity provider (task 056): better-auth's own endpoint set,
   * mounted on its documented base path. It rides the **admin** mount flag rather
   * than a flag of its own - an authoring surface always needs somewhere to sign
   * in, and a respondent-only process must not carry one - but it is a separate
   * group because it is the one admin-facing surface that cannot sit behind the
   * admin-session gate: it is what issues the session in the first place.
   */
  readonly auth?: readonly SliceRegistrar[];
}

/**
 * Mount prefixes per surface (admin isolated under `/admin`, ARCHITECTURE §5.1).
 *
 * `auth` is better-auth's `basePath` default and is matched by the instance's own
 * `basePath` option, so the library builds the same URLs it is served at.
 *
 * `public` is `prod`'s respondent surface and carries **no prefix**, which is the half
 * of Q21 that keeps every link that exists working. A non-prod environment's prefix is
 * derived from its name by {@link environmentPrefix} rather than listed here, because
 * the set is configurable (Q1) and a list would go stale the first time an operator
 * created an environment.
 */
const MOUNT_PREFIX = {
  public: "/",
  internal: "/internal",
  admin: "/admin",
  auth: "/api/auth",
} as const;

/**
 * The mount prefix of one environment's respondent surface (Q21).
 *
 * `prod` is unprefixed and every other environment is `/<env>`. Exported because the
 * portal's addresses, the admin's minted link URLs and the tests all have to agree with
 * what is mounted here, and three spellings of one rule is two too many.
 */
export function environmentPrefix(environment: string): string {
  return environment === PROD_ENVIRONMENT ? MOUNT_PREFIX.public : `/${environment}`;
}

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
  // `defaultHook` is what makes a request-schema refusal go through `onError`
  // rather than around it (issue #182). It is set on every `OpenAPIHono` this
  // module builds - explicitly, at each construction site, rather than relying
  // on the library's parent-app lookup, which is a private field of the class
  // and only linked once a group is mounted.
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: validationErrorHook });

  // Uniform error rendering for everything below.
  app.onError(errorEnvelope(deps));

  // The `SpanKind.SERVER` span for this request, and the point where an inbound
  // W3C `traceparent` (the portal BFF's, over the SEC-4 hop) is extracted and
  // becomes this span's parent - so one respondent action is one trace across
  // both services (task 054, ADR-34).
  //
  // Unconditional, and safe to be: `@hono/otel` depends on `@opentelemetry/api`
  // only, so with no SDK registered (`OTEL_EXPORTER_OTLP_ENDPOINT` unset) it
  // resolves the no-op tracer and records nothing. Header capture is left unset
  // on purpose: `authorization` and the SEC-4 internal token travel in headers,
  // and SEC-13 keeps them out of every signal.
  //
  // FIRST, above the request logger, so the correlation id below has a span to
  // attach itself to.
  app.use("*", httpInstrumentationMiddleware());

  // Correlation id + structured request log wraps every request.
  app.use("*", requestLogger(deps));

  // SEC-9 response headers on every response, refusals included (040).
  app.use("*", securityHeaders());

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
    environment?: string,
  ): void => {
    if (!enabled) return;
    const group = new OpenAPIHono<ApiEnv>({ defaultHook: validationErrorHook });
    group.use("*", internalToken(deps));
    // A respondent group is pinned to its own environment (Q21, Q2). Not a header and
    // not a body field: the group a request was served by IS its environment, so there
    // is nothing a respondent could send that would change it, and every handler below
    // reads its pool through `forRequest(c.get("requestEnvironment"))`.
    if (environment !== undefined) group.use("*", fixedEnvironment(environment));
    for (const register of registrars ?? []) {
      register(group, deps);
    }
    app.route(prefix, group);
  };

  // `prod`'s respondent surface: the loop at its unprefixed addresses, plus anonymous
  // entry, which only this surface carries (SEC-14).
  mount(flags.public, MOUNT_PREFIX.public, groups.respondent, PROD_ENVIRONMENT);
  mount(flags.public, MOUNT_PREFIX.public, groups.anonymous, PROD_ENVIRONMENT);
  // One respondent surface per mounted non-prod environment, at `/<env>` (Q21). The
  // anonymous group is deliberately absent from every one of them: that absence is
  // criterion 3, and it is a routing fact rather than a check.
  for (const environment of flags.environments ?? []) {
    mount(true, environmentPrefix(environment), groups.respondent, environment);
  }
  mount(flags.internal, MOUNT_PREFIX.internal, groups.internal);
  mount(flags.admin, MOUNT_PREFIX.admin, groups.admin);
  // The identity provider, mounted with (and only with) the admin surface. It is
  // still behind the SEC-4 internal token, which `mount` installs: these endpoints
  // are unauthenticated in the *user* sense (no session exists before sign-in), and
  // the channel gate is what keeps them off any public network. See
  // `features/auth/route.ts` for why the group is an allowlist and not a bare
  // catch-all.
  mount(flags.admin, MOUNT_PREFIX.auth, groups.auth);

  return app;
}
