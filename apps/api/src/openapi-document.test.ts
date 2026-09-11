/**
 * OpenAPI document guards (task 027, exit criterion 4).
 *
 * These run in the ordinary unit project (`pnpm test`, no Docker) and enforce
 * three properties of the committed `docs/openapi/*.json`:
 *
 * 1. **Drift** - the committed files deep-equal freshly generated output. A
 *    route schema change that is not regenerated (`pnpm openapi:generate`) fails
 *    here, the same guard shape as the golden corpora and the env reference.
 * 2. **Validity** - each document validates against the OpenAPI spec via a
 *    third-party validator (`@seriousme/openapi-schema-validator`), so a
 *    structurally invalid document cannot be committed.
 * 3. **Partition** - every route the composed app mounts appears in exactly one
 *    document; the two documents never overlap.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { buildApiDocuments, type OpenApiDocument } from "./openapi-document.js";
import { appGroups } from "./registrars.js";
import { makeDeps, validEnv } from "./test-support.js";

const REPO_ROOT = new URL("../../../", import.meta.url);
function readCommitted(name: string): OpenApiDocument {
  const path = fileURLToPath(new URL(`docs/openapi/${name}.json`, REPO_ROOT));
  return JSON.parse(readFileSync(path, "utf8")) as OpenApiDocument;
}

/** Flatten a document to its `"METHOD path"` operation set. */
function operations(doc: OpenApiDocument): Set<string> {
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(item)) {
      // Only HTTP verbs are operations; `parameters` etc. are not.
      if (["get", "put", "post", "delete", "patch", "options", "head"].includes(method)) {
        ops.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return ops;
}

const generated = buildApiDocuments();

describe("committed OpenAPI documents (exit criterion 4)", () => {
  it("respondent.json deep-equals freshly generated output (drift guard)", () => {
    expect(readCommitted("respondent")).toEqual(generated.respondent);
  });

  it("admin.json deep-equals freshly generated output (drift guard)", () => {
    expect(readCommitted("admin")).toEqual(generated.admin);
  });

  it("both documents are labelled x-stability: internal (descriptive, not a promise)", () => {
    expect((generated.respondent as unknown as Record<string, unknown>)["x-stability"]).toBe(
      "internal",
    );
    expect((generated.admin as unknown as Record<string, unknown>)["x-stability"]).toBe("internal");
  });

  it("respondent.json validates against the OpenAPI spec", async () => {
    const result = await new Validator().validate(
      readCommitted("respondent") as unknown as Record<string, unknown>,
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("admin.json validates against the OpenAPI spec", async () => {
    const result = await new Validator().validate(
      readCommitted("admin") as unknown as Record<string, unknown>,
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("respondent write endpoints carry responses:write (SEC-5, issues #7 and #15)", () => {
  /** The `MachineToken` scopes annotated on a `"METHOD path"` operation. */
  function scopesFor(doc: OpenApiDocument, method: string, path: string): string[] {
    const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
      { security?: Array<Record<string, string[]>> } | undefined;
    const requirement = op?.security?.find((r) => "MachineToken" in r);
    return requirement?.MachineToken ?? [];
  }

  // Start a session (#7), append an answer (#7), submit the session (#15).
  // Parameterized because the lint rule rejects three same-shaped `it` blocks.
  it.each(["/sessions", "/sessions/{id}/answers", "/sessions/{id}/submit"])(
    "POST %s requires responses:write, not responses:read",
    (path) => {
      const scopes = scopesFor(generated.respondent, "post", path);
      expect(scopes).toContain("responses:write");
      expect(scopes).not.toContain("responses:read");
    },
  );

  it("the respondent read endpoints keep responses:read (no scope widening)", () => {
    expect(scopesFor(generated.respondent, "get", "/sessions/{id}")).toEqual(["responses:read"]);
    expect(scopesFor(generated.respondent, "get", "/sessions/{id}/step")).toEqual([
      "responses:read",
    ]);
  });
});

describe("route partition - every mounted route in exactly one document", () => {
  // The full enterprise composition (all surfaces): the ground-truth route set.
  const fullApp = createApp(
    makeDeps({ env: validEnv() }),
    { public: true, internal: true, admin: true },
    { groups: appGroups },
  );
  const full = operations(
    fullApp.getOpenAPIDocument({ openapi: "3.0.3", info: { title: "full", version: "0" } }),
  );
  const respondent = operations(generated.respondent);
  const admin = operations(generated.admin);

  it("the two documents are disjoint", () => {
    const overlap = [...respondent].filter((op) => admin.has(op));
    expect(overlap).toEqual([]);
  });

  it("their union is exactly the mounted route set (nothing missing, nothing extra)", () => {
    const union = new Set([...respondent, ...admin]);
    expect([...union].sort()).toEqual([...full].sort());
  });
});

/** The query parameters an operation declares, by name. */
function queryParams(doc: OpenApiDocument, method: string, path: string): Map<string, unknown> {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
    { parameters?: Array<{ name?: string; in?: string; schema?: unknown }> } | undefined;
  const found = new Map<string, unknown>();
  for (const param of op?.parameters ?? []) {
    if (param.in === "query" && typeof param.name === "string") found.set(param.name, param.schema);
  }
  return found;
}

/** The status codes an operation documents, as strings. */
function responseCodes(doc: OpenApiDocument, method: string, path: string): string[] {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
    { responses?: Record<string, unknown> } | undefined;
  return Object.keys(op?.responses ?? {});
}

// The committed document rather than the generated one: the drift guard above
// already ties the two together, so asserting here on what is on disk is what
// makes this a contract test rather than a second reading of the same object.
const committedAdmin = readCommitted("admin");

describe("the form library list declares its filters in the contract (issue 686)", () => {
  it.each(["status", "search", "sort"])(
    "GET /admin/forms accepts ?%s, so a filtered library is a URL a client can build",
    (name) => {
      expect([...queryParams(committedAdmin, "get", "/admin/forms").keys()]).toContain(name);
    },
  );

  it("pins the values the filters accept, so a client cannot guess a fifth sort key", () => {
    const params = queryParams(committedAdmin, "get", "/admin/forms");
    expect(params.get("status")).toMatchObject({ enum: ["open", "closed"] });
    expect(params.get("sort")).toMatchObject({
      enum: ["slug-asc", "slug-desc", "published-desc", "published-asc"],
    });
    // Bounded, so an unbounded search term is refused by the contract and not only
    // by the handler that would otherwise scan every row with it.
    expect(params.get("search")).toMatchObject({ maxLength: 200 });
  });

  it("answers 400 for a refused filter, which is the shape the BFF renders", () => {
    expect(responseCodes(committedAdmin, "get", "/admin/forms")).toContain("400");
  });
});

describe("the question library list bounds its search term too (issue #862)", () => {
  // The question library was the unbounded half of the pair 686 left behind: the
  // forms list capped its search at 200 and this one had no bound at all, so an
  // arbitrarily long pattern reached the per-row match. The bound belongs in the
  // published contract and not only in the handler, because a generated client is
  // entitled to know what the route will refuse before it sends it.
  it("publishes ?search with the same 200-character cap the form list carries", () => {
    expect(queryParams(committedAdmin, "get", "/admin/questions").get("search")).toMatchObject({
      type: "string",
      maxLength: 200,
    });
  });

  it("documents the 400 an over-long term gets, through the standard envelope", () => {
    expect(responseCodes(committedAdmin, "get", "/admin/questions")).toContain("400");
    const op = (
      committedAdmin.paths?.["/admin/questions"] as Record<string, unknown> | undefined
    )?.["get"] as {
      responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
    };
    expect(op.responses?.["400"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/ErrorEnvelope",
    });
  });

  it("keeps the two library searches bounded identically, since they are one screen twice", () => {
    const questions = queryParams(committedAdmin, "get", "/admin/questions").get("search");
    const forms = queryParams(committedAdmin, "get", "/admin/forms").get("search");
    expect(questions).toMatchObject({ maxLength: 200 });
    expect(forms).toMatchObject({ maxLength: 200 });
  });
});

describe("the settings patch publishes its empty-patch rule (issue #242)", () => {
  // `UpdateFormSettingsBody` rejects an all-absent body with a 400, and that rule
  // was a Zod `.refine()` with no JSON Schema expression: the published schema
  // showed two optional fields, no `required` array, and nothing at all about the
  // rule. The server was right and the contract was wrong. `minProperties: 1` is
  // the machine-readable form, so this asserts the machine-readable form.
  const schema = (committedAdmin.components?.schemas?.["UpdateFormSettingsBody"] ?? {}) as {
    minProperties?: number;
    description?: string;
    properties?: Record<string, unknown>;
  };

  it("carries minProperties: 1, so a generated client knows `{}` is refused", () => {
    expect(schema.minProperties).toBe(1);
  });

  it("still declares both settings optional - the rule is at-least-one, not both", () => {
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "challengeRequired",
      "minSubmitMs",
    ]);
    expect(schema).not.toHaveProperty("required");
  });

  it("says the rule in prose as well, naming the code the refusal carries", () => {
    expect(schema.description).toContain("challengeRequired");
    expect(schema.description).toContain("minSubmitMs");
    expect(schema.description).toContain("INVALID_REQUEST");
  });

  it("documents the 400 through the standard envelope, as the refusal renders it", () => {
    expect(responseCodes(committedAdmin, "patch", "/admin/forms/{id}/settings")).toContain("400");
    const op = (
      committedAdmin.paths?.["/admin/forms/{id}/settings"] as Record<string, unknown> | undefined
    )?.["patch"] as {
      responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
    };
    expect(op.responses?.["400"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/ErrorEnvelope",
    });
  });
});
