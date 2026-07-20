/**
 * Generated OpenAPI documents for the two public-facing surfaces (task 027).
 *
 * The routes in this codebase are all declared with `@hono/zod-openapi`
 * `createRoute` (017's convention), so the OpenAPI description of the API is a
 * *derived artifact* of the same Zod schemas the handlers validate against - it
 * cannot drift from the implementation. This module composes the app exactly as
 * `serve.ts` does (via the shared {@link appGroups}) and emits one document per
 * surface:
 *
 * - **respondent** - the public loop a form filler's client talks to, plus the
 *   always-on `/health` and `/ready` ops probes.
 * - **admin** - the authoring / response-ops / webhook-config surface, mounted
 *   under `/admin`. The ops probes are omitted here (they belong to the
 *   respondent document) so **every mounted route appears in exactly one
 *   document** (027 exit criterion 4).
 *
 * Both are labelled `x-stability: internal`: they *describe the current build*,
 * they are not a compatibility promise. The no-stability-contract stance of
 * `ARCHITECTURE.md` §5.1 holds until the reserved `/api/v1` surface activates.
 *
 * The documents are deps-independent: `createRoute` metadata is static, so the
 * placeholder deps built here (no database, no secrets) yield the exact same
 * document the running server would. `buildApiDocuments()` is therefore the
 * single generator behind both the committed files (`docs/openapi/*.json`) and
 * the drift check that guards them.
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Executor } from "@qcms/db";

import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { nullChallengeVerifier } from "./features/responses/challenge.js";
import { createNullLogger } from "./logger.js";
import { InMemoryRateLimitStore } from "./rate-limit.js";
import { appGroups } from "./registrars.js";

/** A JSON OpenAPI document (structurally; we treat it as opaque JSON). */
export type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPIDocument"]>;

/** The two committed documents, keyed by their surface. */
export interface ApiDocuments {
  readonly respondent: OpenApiDocument;
  readonly admin: OpenApiDocument;
}

/** The always-on ops probes; they live in the respondent document only. */
const OPS_PATHS = ["/health", "/ready"] as const;

/**
 * Placeholder environment for code generation. These are **not secrets** - they
 * are fixed, obviously-synthetic strings that only exist to satisfy the config
 * validator's shape checks (min length, url scheme). No handler runs during
 * generation, so nothing here reaches the wire.
 */
const CODEGEN_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://codegen:codegen@localhost:5432/codegen",
  QCMS_MOUNT: "all",
  QCMS_LINK_KEYS: "codegen-openapi-placeholder-value-000000000",
  QCMS_SESSION_KEYS: "codegen-openapi-placeholder-value-000000000",
  QCMS_INTERNAL_TOKEN: "codegen-openapi-placeholder-value-000000000",
  QCMS_APP_KEY: "codegen-openapi-placeholder-value-000000000",
  QCMS_PORTAL_BASE_URL: "https://forms.example.test",
};

/** A database handle that rejects any use - generation never queries. */
function inertDb(): Executor {
  return new Proxy(
    {},
    {
      get() {
        return () => Promise.reject(new Error("openapi generation must not touch the database"));
      },
    },
  ) as unknown as Executor;
}

/** Self-contained deps for document generation (no DB, no real secrets). */
function codegenDeps(): Deps {
  const config = loadConfig(CODEGEN_ENV);
  const clock = systemClock;
  return {
    db: inertDb(),
    config,
    clock,
    logger: createNullLogger(),
    rateLimitStore: new InMemoryRateLimitStore(clock),
    challenge: nullChallengeVerifier,
    flags: config.flags,
  };
}

/** The OpenAPI document config shared by both surfaces. */
function docConfig(
  title: string,
  description: string,
): Parameters<OpenAPIHono["getOpenAPIDocument"]>[0] & { "x-stability": string } {
  return {
    openapi: "3.0.3",
    info: {
      title,
      version: "0.0.0",
      description,
    },
    // Descriptive, not a promise: these documents track the current build. The
    // compatibility contract begins with the reserved /api/v1 surface (R7).
    "x-stability": "internal",
  };
}

/** Remove the ops-probe paths from a document (they belong to respondent only). */
function stripOpsPaths(doc: OpenApiDocument): OpenApiDocument {
  const paths = { ...(doc.paths ?? {}) };
  for (const p of OPS_PATHS) delete paths[p];
  return { ...doc, paths };
}

/**
 * Build both surface documents from the shared composition. Deterministic and
 * deps-independent: the same route metadata `serve.ts` mounts.
 */
export function buildApiDocuments(): ApiDocuments {
  const deps = codegenDeps();

  // Pass the full registrar set to both; `createApp` mounts only the surfaces
  // whose flag is set (ADR-09), so each app carries exactly its own routes.
  const respondentApp = createApp(
    deps,
    { public: true, internal: false, admin: false },
    { groups: appGroups },
  );
  const adminApp = createApp(
    deps,
    { public: false, internal: true, admin: true },
    { groups: appGroups },
  );

  const respondent = respondentApp.getOpenAPIDocument(
    docConfig(
      "qcms respondent API",
      "The public respondent loop: start a session, walk the branching flow, submit. Plus the always-on liveness/readiness probes.",
    ),
  );
  // The ops probes are mounted in every process shape; keep them in the
  // respondent document only so each route appears in exactly one document.
  const admin = stripOpsPaths(
    adminApp.getOpenAPIDocument(
      docConfig(
        "qcms admin API",
        "The internal authoring surface (mounted under /admin): questions, forms, secure links, responses/export/erasure, webhooks, and outbox delivery ops.",
      ),
    ),
  );

  return { respondent, admin };
}
