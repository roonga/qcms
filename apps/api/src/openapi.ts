import { z } from "@hono/zod-openapi";

import type { VerifiedProposal } from "./features/agent/provenance.js";
import type { GrantContext } from "./features/membership/context.js";

/** `scopes` is SEC-5 metadata, reserved for `/api/v1` and inert at launch. */
export interface AdminPrincipal {
  readonly userId: string;
  /** Nothing branches on it: authorization at launch is "authenticated admin". */
  readonly role: string;
  readonly scopes: readonly Scope[];
}

export interface ApiEnv {
  readonly Variables: {
    requestId: string;
    adminPrincipal?: AdminPrincipal;
    /**
     * Optional because a handler composed outside a mounted group has neither source,
     * and an admin client may name nothing; `Databases.forRequest` then falls back to
     * `prod`.
     */
    requestEnvironment?: string;
    /**
     * Mounted on the admin group alone, so absent on every respondent request. A handler
     * reads this rather than resolving a grant again: a second resolution is a second
     * chance to disagree with the first (ADR-41, SEC-3).
     */
    grantContext?: GrantContext;
    /**
     * Set only by the provenance middleware, and only for a request whose token verified
     * against the authenticated principal. Its presence is what makes a handler write a
     * `control.agent_actions` row; it carries no authority of its own (SEC-17).
     */
    agentProposal?: VerifiedProposal;
  };
}

/** Mirrors {@link ErrorEnvelope} in errors.ts; the two must stay in step. */
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
 * One constant for both library lists so the two bounds cannot drift. A search term is
 * matched per row, so an unbounded one is unbounded work. The admin's own `maxLength` is
 * a courtesy, not a guard, and cannot import this: the admin proxies to the API (R2).
 */
export const LIBRARY_SEARCH_MAX_LENGTH = 200;

/**
 * Request bodies are closed (`z.strictObject`), so an unknown key is refused at runtime
 * instead of silently stripped and the generated document publishes
 * `additionalProperties: false` from the same declaration. Maps whose keys are the
 * caller's data are `z.record` and stay open.
 */
export interface JsonBodyOptions {
  /**
   * Its presence is the deliberate opt-out; nothing branches on the text. The one case is
   * `POST /sessions/{id}/submit`, where refusing an unknown key would let a bot find the
   * configured honeypot field by comparing a 400 against a 200.
   */
  readonly openBecause?: string;
}

export interface JsonRequestBody<T extends z.ZodType> {
  readonly required: true;
  readonly content: { readonly "application/json": { readonly schema: T } };
}

/**
 * Zod's unknown-key setting is not part of its public surface, so it is read through a
 * local shape; `openapi.test.ts` pins the values so a Zod upgrade fails there rather than
 * silently widening the API.
 */
interface UnknownKeyPolicyProbe {
  readonly _zod?: { readonly def?: { readonly type?: string; readonly catchall?: unknown } };
}

type UnknownKeyPolicy = "reject" | "keep" | "strip" | "not-an-object";

function unknownKeyPolicy(schema: z.ZodType): UnknownKeyPolicy {
  const def = (schema as UnknownKeyPolicyProbe)._zod?.def;
  if (def?.type !== "object") return "not-an-object";
  const catchall = def.catchall as UnknownKeyPolicyProbe | undefined;
  if (catchall === undefined) return "strip";
  return catchall._zod?.def?.type === "never" ? "reject" : "keep";
}

/**
 * The only spelling of a JSON request body, so the unknown-key policy is enforced at
 * module load rather than left to each new route.
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

/** SEC-5 taxonomy, reserved for `/api/v1`: erase is never bundled into a broad grant. */
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

export const PAT_SECURITY_SCHEME = "MachineToken";

/** Documents the scopes `/api/v1` will require; enforces nothing at launch (SEC-5). */
export function withScopes(...scopes: readonly Scope[]): {
  security: Array<Record<string, Scope[]>>;
} {
  // A mutable copy: `createRoute`'s `security` types its scope lists as mutable
  // `string[]`, so a `readonly` array is rejected where the fragment is spread.
  return { security: [{ [PAT_SECURITY_SCHEME]: [...scopes] }] };
}
