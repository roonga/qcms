/**
 * Route-definition convention (task 017; ARCHITECTURE §5.1–5.2; SEC-5).
 *
 * Every route in this codebase is declared with `@hono/zod-openapi`'s
 * `createRoute` - request/response Zod schemas and typed error responses - and
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
 * SEC-5 metadata - reserved for `/api/v1` activation (Phase 4), inert at launch.
 * Today a permissive stub establishes it; 031 swaps in real better-auth session
 * verification without changing this shape.
 */
export interface AdminPrincipal {
  readonly userId: string;
  /**
   * SEC-3 role claim, carried from day one so Phase 4 RBAC is additive code
   * rather than a schema change. Launch issues a single value (`admin`) and
   * nothing branches on it: authorization at launch is "authenticated admin".
   */
  readonly role: string;
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

/** The error-envelope body schema - mirrors {@link ErrorEnvelope} in errors.ts. */
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
 * The longest search term either library list accepts, in characters (issues #686,
 * #862).
 *
 * Shared rather than written twice because the question library and the form library
 * are the same screen twice: a term one of them refuses is a term the other refuses,
 * and issue #862 exists because the two had drifted - the form list was capped at 200
 * and the question list had no bound at all, so an arbitrarily long pattern reached the
 * per-row match. Two literals in two slices is how that drift happened, and one
 * constant is what stops it happening again.
 *
 * It lives here, with the other pieces both slices' route contracts reuse, rather than
 * in either slice: importing one feature's schema module into the other's would couple
 * two slices to say something neither of them owns. A search term is matched per row in
 * the handler, so an unbounded one is unbounded work; 200 characters is far past any
 * slug, question label or form title an author writes, and past it a route answers 400
 * through the envelope below rather than doing the work.
 *
 * The admin has its own copy for the input's `maxLength` (`apps/admin/lib/library-search.ts`),
 * which is a courtesy to the author and not a guard. That one cannot import this one:
 * the admin never imports from the API, it proxies to it (R2).
 */
export const LIBRARY_SEARCH_MAX_LENGTH = 200;

// --- request bodies: the unknown-key policy (#893) ---------------------------

/**
 * How a request-body object answers a key its schema does not declare.
 *
 * **The API rejects it** (Code Owner, 2026-09-19, issue #893). One policy, on
 * both surfaces. Zod's default is to *strip* the key, which produced the exact
 * disagreement #893 was filed about: `PATCH /admin/forms/{id}/settings` with
 * `{ "challengeRequired": true, "unknownField": 1 }` answered 200 and silently
 * dropped the second key, while the published schema - generated from the same
 * Zod object, and carrying no `additionalProperties` at all - told a generated
 * client the body was fine. A misspelled field was a success with no effect.
 *
 * A closed object is `z.strictObject`, which does two things at once: it refuses
 * the key at runtime (the hook in `middleware/validation-hook.ts` turns that into
 * a 400 `INVALID_REQUEST` naming it) and it publishes
 * `additionalProperties: false` in `docs/openapi/*.json`. Server and document
 * therefore cannot disagree, because both come from the one declaration.
 *
 * {@link jsonBody} is where the policy is *enforced* rather than remembered. It
 * is the only spelling of a JSON request body in this codebase, and it reads the
 * schema's own unknown-key setting and throws at module load - when the route
 * module is imported, before a single request - if the body is neither closed nor
 * explicitly opened with a reason. A new slice that writes `z.object` for its body
 * does not get a silent strip; it gets a refusal naming the fix. The nested half of
 * the property (an object inside a body, an object inside an array inside a body)
 * is guarded by the contract test in `openapi-document.test.ts`, which walks every
 * request-body schema in both published documents and in the all-flags-on
 * composition.
 *
 * `additionalProperties: false` belongs on **closed** objects only. A map whose
 * keys are legitimately the caller's data - an answer map keyed by question id, a
 * kernel-validated definition - stays open and keeps describing its values. Those
 * are `z.record`, are unaffected by this helper, and are listed with their reasons
 * in the contract test's allowlist.
 */
export interface JsonBodyOptions {
  /**
   * Set only on a body that must stay **open**, and set to the reason why. The
   * text is documentation for the next reader, not a parameter anything branches
   * on: its presence is the deliberate opt-out, and a body that carries a reason
   * while being closed is refused too, so a reason cannot go stale unnoticed.
   *
   * There is exactly one at the time of writing - `POST /sessions/{id}/submit`,
   * whose honeypot field name is deployment-configured, and where refusing an
   * unknown key would let a bot find the trap by comparing a 400 against a 200.
   */
  readonly openBecause?: string;
}

/** The `request.body` fragment a route spreads into `createRoute`. */
export interface JsonRequestBody<T extends z.ZodType> {
  readonly required: true;
  readonly content: { readonly "application/json": { readonly schema: T } };
}

/**
 * Zod records the unknown-key setting as a `catchall` schema on the object's
 * definition: `never` for `z.strictObject` (reject), `unknown` for
 * `z.looseObject` (keep), absent for a default `z.object` (strip). Read through a
 * local shape rather than Zod's internal types, which are not part of its public
 * surface; the three values are pinned by tests in `openapi.test.ts` so a Zod
 * upgrade that changed them would fail there rather than silently widening the API.
 */
interface UnknownKeyPolicyProbe {
  readonly _zod?: { readonly def?: { readonly type?: string; readonly catchall?: unknown } };
}

/** What a schema does with a key it does not declare. */
type UnknownKeyPolicy = "reject" | "keep" | "strip" | "not-an-object";

function unknownKeyPolicy(schema: z.ZodType): UnknownKeyPolicy {
  const def = (schema as UnknownKeyPolicyProbe)._zod?.def;
  if (def?.type !== "object") return "not-an-object";
  const catchall = def.catchall as UnknownKeyPolicyProbe | undefined;
  if (catchall === undefined) return "strip";
  return catchall._zod?.def?.type === "never" ? "reject" : "keep";
}

/**
 * The JSON request body for a route, with the {@link JsonBodyOptions} policy
 * enforced at module load.
 *
 * Every `createRoute` in this codebase declares its body through this function
 * and never as a bare `{ required: true, content: ... }` literal, which is what
 * makes "request bodies reject unknown keys" a property of the codebase instead
 * of a convention a new slice has to be told about.
 */
export function jsonBody<T extends z.ZodType>(
  schema: T,
  options: JsonBodyOptions = {},
): JsonRequestBody<T> {
  const policy = unknownKeyPolicy(schema);
  if (options.openBecause === undefined) {
    if (policy !== "reject") {
      throw new Error(
        `A JSON request body must be a z.strictObject so an unknown key is refused rather than ` +
          `stripped, and so the generated document publishes additionalProperties: false ` +
          `(issue #893). This schema is ${policy === "strip" ? "a plain z.object" : policy}. ` +
          `Either declare it with z.strictObject, or pass openBecause with the reason it must ` +
          `stay open.`,
      );
    }
  } else if (policy !== "keep") {
    throw new Error(
      `This JSON request body passes openBecause but is not an open object (it is ${policy}), so ` +
        `the stated reason no longer describes it. Declare it with z.looseObject or drop ` +
        `openBecause (issue #893).`,
    );
  }
  return { required: true, content: { "application/json": { schema } } };
}

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
  "responses:write",
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
