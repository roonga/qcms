import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Executor } from "@roonga/qcms-db";

import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { unavailableDraftAssistant } from "./features/forms/assist/assistant.js";
import { nullChallengeVerifier } from "./features/responses/challenge.js";
import { createNullLogger } from "./logger.js";
import { InMemoryRateLimitStore } from "./rate-limit.js";
import { appGroups } from "./registrars.js";
import { PROD_ENVIRONMENT } from "./environments.js";

export type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPIDocument"]>;

export interface ApiDocuments {
  readonly respondent: OpenApiDocument;
  readonly admin: OpenApiDocument;
}

const OPS_PATHS = ["/health", "/ready"] as const;

// Not secrets: synthetic strings that only satisfy the config validator's shape checks.
// No handler runs and no connection opens during generation.
const CODEGEN_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://codegen:codegen@localhost:5432/codegen",
  QCMS_ENVIRONMENTS: "test,prod",
  QCMS_DATABASE_URL_TEST: "postgres://codegen:codegen@localhost:5432/codegen",
  QCMS_DATABASE_URL_PROD: "postgres://codegen:codegen@localhost:5432/codegen",
  QCMS_MOUNT: "all",
  QCMS_LINK_KEYS: "codegen-openapi-placeholder-value-000000000",
  QCMS_SESSION_KEYS: "codegen-openapi-placeholder-value-000000000",
  QCMS_INTERNAL_TOKEN: "codegen-openapi-placeholder-value-000000000",
  QCMS_APP_KEY: "codegen-openapi-placeholder-value-000000000",
  QCMS_PORTAL_BASE_URL: "https://forms.example.test",
  QCMS_ADMIN_AUTH_SECRET: "codegen-openapi-placeholder-value-000000000",
  QCMS_ADMIN_BASE_URL: "https://admin.example.test",
};

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

function codegenDeps(): Deps {
  const config = loadConfig(CODEGEN_ENV);
  const clock = systemClock;
  const inert = inertDb();
  return {
    databases: {
      control: inert,
      names: config.environments.map((environment) => environment.name),
      defaultEnvironment: PROD_ENVIRONMENT,
      for: () => inert,
      forRequest: () => ({ environment: PROD_ENVIRONMENT, exec: inert }),
    },
    config,
    clock,
    logger: createNullLogger(),
    rateLimitStore: new InMemoryRateLimitStore(clock),
    challenge: nullChallengeVerifier,
    // Agent flag off, so the flag-gated assist route stays out of the published documents,
    // matching a default deployment.
    draftAssistant: unavailableDraftAssistant,
    flags: config.flags,
  };
}

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
    // Descriptive, not a promise: the compatibility contract begins at /api/v1 (R7).
    "x-stability": "internal",
  };
}

function stripOpsPaths(doc: OpenApiDocument): OpenApiDocument {
  const paths = { ...(doc.paths ?? {}) };
  for (const p of OPS_PATHS) delete paths[p];
  return { ...doc, paths };
}

export function buildApiDocuments(): ApiDocuments {
  const deps = codegenDeps();

  // Safe to pass the full registrar set to both: `createApp` mounts only the surfaces
  // whose flag is set (ADR-09).
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
  // The probes mount in every process shape; keeping them only here makes each route
  // appear in exactly one document.
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
