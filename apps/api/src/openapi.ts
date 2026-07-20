/**
 * Route-definition convention (task 017; ARCHITECTURE §5.1–5.2; SEC-5).
 *
 * Every route in this codebase is declared with `@hono/zod-openapi`'s
 * `createRoute` — request/response Zod schemas and typed error responses — and
 * **never** as a bare Hono route. Zod stays the single schema language and the
 * implementation's source of truth, so the OpenAPI documents 027 generates are
 * derived artifacts that cannot drift.
 *
 * This module carries the shared pieces slices reuse: the request context type,
 * the error-envelope response schema, an `errorResponses` helper, the SEC-5
 * scope taxonomy, and `withScopes` for annotating a route's intended scopes as
 * security metadata (activated for `/api/v1` in Phase 4; annotated from day one
 * so activation is wiring, not archaeology).
 */

import { z } from "@hono/zod-openapi";

/**
 * The authenticated admin principal an admin-group request carries once the
 * admin-auth middleware (021) has verified its session. The `scopes` list is
 * SEC-5 metadata — reserved for `/api/v1` activation (Phase 4), inert at launch.
 * Today a permissive stub establishes it; 031 swaps in real better-auth session
 * verification without changing this shape.
 */
export interface AdminPrincipal {
  readonly userId: string;
  readonly scopes: readonly Scope[];
}

/** Per-request context set by middleware and read by handlers/error envelope. */
export interface ApiEnv {
  readonly Variables: {
    /** Correlation id for this request (echoed as `x-request-id`). */
    requestId: string;
    /** Authenticated admin principal, set by the admin-auth middleware (021). */
    adminPrincipal?: AdminPrincipal;
  };
}

/** The error-envelope body schema — mirrors {@link ErrorEnvelope} in errors.ts. */
export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "unauthorized" }),
      message: z.string().openapi({ example: "Missing or invalid internal service token" }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorEnvelope");

/**
 * Standard error responses for a route. Pass the status codes a route can
 * return; each maps to the shared envelope schema so the generated OpenAPI
 * documents describe errors uniformly.
 */
export function errorResponses(
  ...statuses: readonly number[]
): Record<
  number,
  { description: string; content: { "application/json": { schema: typeof ErrorEnvelopeSchema } } }
> {
  const descriptions: Record<number, string> = {
    400: "Bad request",
    401: "Missing or invalid credentials",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    413: "Payload too large",
    422: "Unprocessable entity",
    429: "Rate limited",
    500: "Internal server error",
    503: "Service unavailable",
  };
  const out: Record<
    number,
    { description: string; content: { "application/json": { schema: typeof ErrorEnvelopeSchema } } }
  > = {};
  for (const status of statuses) {
    out[status] = {
      description: descriptions[status] ?? "Error",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    };
  }
  return out;
}

/**
 * The SEC-5 scope taxonomy (`/api/v1`, reserved). Fixed now so route
 * annotations exist from day one; erase is never bundled into a broad grant.
 */
export const SCOPES = [
  "forms:read",
  "forms:write",
  "questions:read",
  "questions:write",
  "responses:read",
  "responses:export",
  "responses:erase",
  "links:mint",
  "webhooks:manage",
] as const;
export type Scope = (typeof SCOPES)[number];

/** Name of the reserved bearer security scheme (PATs) in generated documents. */
export const PAT_SECURITY_SCHEME = "MachineToken";

/**
 * Annotate a route with the scopes it will require when `/api/v1` activates
 * (SEC-5). Returns the `security` fragment to spread into a `createRoute` call;
 * surfaces in the generated OpenAPI security requirements without enforcing
 * anything at launch.
 */
export function withScopes(...scopes: readonly Scope[]): {
  security: Array<Record<string, Scope[]>>;
} {
  // A mutable copy: `createRoute`'s `security` (OpenAPI `SecurityRequirementObject[]`)
  // types its scope lists as mutable `string[]`, so a `readonly` array is rejected
  // where the fragment is spread into a route (018 is the first consumer).
  return { security: [{ [PAT_SECURITY_SCHEME]: [...scopes] }] };
}
