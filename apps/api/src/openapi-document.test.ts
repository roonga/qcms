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

function operations(doc: OpenApiDocument): Set<string> {
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(item)) {
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
  function scopesFor(doc: OpenApiDocument, method: string, path: string): string[] {
    const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
      { security?: Array<Record<string, string[]>> } | undefined;
    const requirement = op?.security?.find((r) => "MachineToken" in r);
    return requirement?.MachineToken ?? [];
  }

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

function queryParams(doc: OpenApiDocument, method: string, path: string): Map<string, unknown> {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
    { parameters?: Array<{ name?: string; in?: string; schema?: unknown }> } | undefined;
  const found = new Map<string, unknown>();
  for (const param of op?.parameters ?? []) {
    if (param.in === "query" && typeof param.name === "string") found.set(param.name, param.schema);
  }
  return found;
}

function responseCodes(doc: OpenApiDocument, method: string, path: string): string[] {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method] as
    { responses?: Record<string, unknown> } | undefined;
  return Object.keys(op?.responses ?? {});
}

// The committed document, not the generated one: asserting on what is on disk is what
// makes these contract tests rather than a second reading of the same object.
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
    expect(params.get("search")).toMatchObject({ maxLength: 200 });
  });

  it("answers 400 for a refused filter, which is the shape the BFF renders", () => {
    expect(responseCodes(committedAdmin, "get", "/admin/forms")).toContain("400");
  });
});

describe("the question library list bounds its search term too (issue #862)", () => {
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

interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string;
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
  readonly additionalProperties?: boolean | SchemaNode;
  readonly allOf?: readonly SchemaNode[];
  readonly anyOf?: readonly SchemaNode[];
  readonly oneOf?: readonly SchemaNode[];
}

// Anything reachable from a request body and not listed here must publish
// `additionalProperties: false`. An entry belongs here only when its keys are the
// caller's own data, so closing it would refuse the data rather than a mistake.
const OPEN_REQUEST_BODY_SCHEMAS: Record<string, string> = {
  FormDefinitionInput:
    "The form definition is opaque at the route boundary so the kernel validates its " +
    "contents and returns coded 422 issues rather than a bare 400. docs/adr/portal.md also " +
    "records that FormDefinition strips unknown keys rather than rejecting them, so closing " +
    "this would contradict a standing decision about stored content.",
  QuestionDefinitionInput:
    "The question definition is opaque for the same reason the form definition is: the " +
    "kernel owns its shape, and restating it at the transport boundary would be a second " +
    "declaration to keep in step.",
  "PreviewConditionBody.answers":
    "A questionId -> AnswerValue map of hypothetical answers the author typed into the rule " +
    "test bench. The keys are question ids, which are the caller's data.",
  "PreviewDraftBody.answers":
    "A questionId -> AnswerValue map of the author's walk-through state, keyed by question id.",
  "PreviewConditionBody.instances":
    "A groupId -> InstanceId[] map of the hypothetical roster the rule test bench minted. The " +
    "keys are group ids, which are the caller's data.",
  "PreviewDraftBody.instances":
    "A groupId -> InstanceId[] map of the hypothetical roster the preview pane minted from each " +
    "group's own min, keyed by group id.",
  SubmitBody:
    "The one request body that stays open (Code Owner, 2026-09-24, issue #893). It has no " +
    "sink: the handler reads one key, the stored submission and the outbox payload are built " +
    "from the answer ledger, and the body is never logged, so an undeclared key reaches " +
    "nothing. And the portal's no-JS path forwards every posted form field the compiled " +
    "document did not tag as an answer control, so a closed body would refuse legitimate " +
    "submissions. It does NOT rest on the honeypot being secret: the field name is a compiler " +
    "constant already published in the respondent document and already in the served DOM.",
  "AcceptProposalBody.definition":
    "The proposed form definition, opaque exactly as FormDefinitionInput is; unnamed in the " +
    "document because the assist routes are flag-gated and must register no component into a " +
    "document a default build publishes.",
  "AcceptProposalBody.newQuestions[].definition":
    "One proposed question definition, opaque exactly as QuestionDefinitionInput is, and " +
    "unnamed for the same flag-gating reason.",
};

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function jsonRequestBodies(doc: OpenApiDocument): Map<string, SchemaNode> {
  const bodies = new Map<string, SchemaNode>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      const schema = (
        operation as
          { requestBody?: { content?: Record<string, { schema?: SchemaNode }> } } | undefined
      )?.requestBody?.content?.["application/json"]?.schema;
      if (schema) bodies.set(`${method.toUpperCase()} ${path}`, schema);
    }
  }
  return bodies;
}

function children(node: SchemaNode, label: string): Array<[string, SchemaNode]> {
  const out: Array<[string, SchemaNode]> = [];
  for (const [key, child] of Object.entries(node.properties ?? {}))
    out.push([`${label}.${key}`, child]);
  if (node.items) out.push([`${label}[]`, node.items]);
  if (typeof node.additionalProperties === "object") {
    out.push([`${label}[*]`, node.additionalProperties]);
  }
  for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    out.push([label, branch]);
  }
  return out;
}

function reachableObjectSchemas(doc: OpenApiDocument): Map<string, SchemaNode> {
  const components = (doc.components?.schemas ?? {}) as Record<string, SchemaNode>;
  const found = new Map<string, SchemaNode>();
  const seenComponents = new Set<string>();

  const pending: Array<[string, SchemaNode]> = [...jsonRequestBodies(doc).values()].map(
    (schema) => ["", schema],
  );
  while (pending.length > 0) {
    const [label, node] = pending.pop() as [string, SchemaNode];
    if (node.$ref) {
      const name = refName(node.$ref);
      if (seenComponents.has(name)) continue;
      seenComponents.add(name);
      const target = components[name];
      if (target) pending.push([name, target]);
      continue;
    }
    if (node.type === "object") found.set(label, node);
    pending.push(...children(node, label));
  }
  return found;
}

function unknownKeyPolicyViolations(doc: OpenApiDocument): string[] {
  const violations: string[] = [];
  for (const [label, node] of reachableObjectSchemas(doc)) {
    if (node.additionalProperties === false) continue;
    if (label in OPEN_REQUEST_BODY_SCHEMAS) continue;
    violations.push(label);
  }
  return violations.sort((a, b) => a.localeCompare(b));
}

// The agent-authoring flag is on so the two flag-gated assist bodies are walked: a
// default build publishes neither, so the committed documents leave them unguarded.
const allSurfaces = createApp(
  makeDeps({ env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }) }),
  { public: true, internal: true, admin: true, environments: [] },
  { groups: appGroups },
).getOpenAPIDocument({ openapi: "3.0.3", info: { title: "all surfaces", version: "0" } });

const WALKED: ReadonlyArray<readonly [string, OpenApiDocument, number]> = [
  ["respondent", readCommitted("respondent"), 6],
  ["admin", committedAdmin, 26],
  ["all surfaces with every flag on", allSurfaces, 34],
];

describe("every request body rejects unknown keys (issue #893)", () => {
  it.each(WALKED)("%s: every object reachable from a body is closed or reasoned", (_name, doc) => {
    expect(unknownKeyPolicyViolations(doc)).toEqual([]);
  });

  it.each(WALKED)(
    "%s: walks the request bodies it is supposed to (%d of them)",
    (_name, doc, count) => {
      expect(jsonRequestBodies(doc).size).toBe(count);
    },
  );

  it("an open map still says what its values are", () => {
    const reachable = reachableObjectSchemas(allSurfaces);
    const untyped = Object.keys(OPEN_REQUEST_BODY_SCHEMAS).filter(
      (label) => typeof reachable.get(label)?.additionalProperties !== "object",
    );
    expect(untyped).toEqual([]);
  });

  it("carries no allowlist entry that nothing reaches any more", () => {
    const reached = new Set(reachableObjectSchemas(allSurfaces).keys());
    const stale = Object.keys(OPEN_REQUEST_BODY_SCHEMAS).filter((label) => !reached.has(label));
    expect(stale).toEqual([]);
  });

  it("states a reason for every open schema, not just a name", () => {
    const unreasoned = Object.entries(OPEN_REQUEST_BODY_SCHEMAS)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([label]) => label);
    expect(unreasoned).toEqual([]);
  });
});

describe("the request-body walk is not vacuous", () => {
  function documentWithBody(schema: SchemaNode): OpenApiDocument {
    return {
      openapi: "3.0.3",
      info: { title: "synthetic", version: "0" },
      paths: {
        "/thing": {
          post: { requestBody: { content: { "application/json": { schema } } }, responses: {} },
        },
      },
    } as unknown as OpenApiDocument;
  }

  const OPEN_OBJECT: SchemaNode = { type: "object", properties: { a: { type: "string" } } };

  it("reports a body left as a plain object, which is what the real walk would miss", () => {
    expect(unknownKeyPolicyViolations(documentWithBody(OPEN_OBJECT))).toEqual([""]);
  });

  it("reports an unclosed object nested inside a closed body", () => {
    expect(
      unknownKeyPolicyViolations(
        documentWithBody({
          type: "object",
          additionalProperties: false,
          properties: { inner: OPEN_OBJECT },
        }),
      ),
    ).toEqual([".inner"]);
  });

  it("reports an unclosed object inside an array inside a closed body", () => {
    expect(
      unknownKeyPolicyViolations(
        documentWithBody({
          type: "object",
          additionalProperties: false,
          properties: { rows: { type: "array", items: OPEN_OBJECT } },
        }),
      ),
    ).toEqual([".rows[]"]);
  });

  it("accepts a body that is closed all the way down", () => {
    expect(
      unknownKeyPolicyViolations(
        documentWithBody({
          type: "object",
          additionalProperties: false,
          properties: {
            rows: {
              type: "array",
              items: { type: "object", additionalProperties: false, properties: {} },
            },
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("the #893 example is refused on the key it actually carries", () => {
  const schema = (committedAdmin.components?.schemas?.["UpdateFormSettingsBody"] ?? {}) as {
    minProperties?: number;
    additionalProperties?: unknown;
  };

  it("publishes additionalProperties: false beside minProperties: 1", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.minProperties).toBe(1);
  });
});
