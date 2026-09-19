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

// --- the request-body unknown-key policy (issue #893) -----------------------

/**
 * A JSON Schema node as the generator spells one. Only the members this walk
 * follows; a document carries more, and nothing here depends on the rest.
 */
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

/**
 * The object schemas reachable from a request body that are deliberately OPEN,
 * each with the reason it is open. Everything else reachable from a request body
 * must publish `additionalProperties: false`, and a schema that is neither closed
 * nor listed here fails the walk below - which is what makes a new body schema
 * strict by default rather than by remembering (issue #893).
 *
 * A label is the component name when the schema is a named component, and
 * otherwise the path the walk took to reach it from the body.
 *
 * `additionalProperties: false` belongs on closed objects only. Every entry here
 * is a *map*: its keys are the caller's own data, so closing it would refuse the
 * data itself rather than a mistake. Each still declares what its values are,
 * which the walk asserts separately - an open map may not degrade to
 * "anything at all, unstated".
 */
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
  SubmitBody:
    "The one request body that stays open. The honeypot field name is deployment " +
    "configuration and the portal's no-JS path forwards every posted form field the compiled " +
    "document did not tag as an answer control, so a closed body would refuse legitimate " +
    "submits. A refusal would also build the oracle this slice exists to deny: a 400 for one " +
    "field name and a 200 for another tells a bot which field is the trap.",
  "AcceptProposalBody.definition":
    "The proposed form definition, opaque exactly as FormDefinitionInput is; unnamed in the " +
    "document because the assist routes are flag-gated and must register no component into a " +
    "document a default build publishes.",
  "AcceptProposalBody.newQuestions[].definition":
    "One proposed question definition, opaque exactly as QuestionDefinitionInput is, and " +
    "unnamed for the same flag-gating reason.",
};

/** The component name a local `$ref` points at. */
function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** The `"METHOD path"` operations of a document that declare a JSON request body. */
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

/** The child nodes of a schema, each with the label the walk reaches it under. */
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

/**
 * Every object schema reachable from a request body in `doc`, keyed by its label.
 *
 * A named component is recorded under its component name and visited once, so the
 * same definition referenced from three bodies is one entry and one allowlist line.
 * An inline schema is recorded under the path the walk took to it.
 */
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

/** Labels of the schemas in `doc` that neither close nor declare a reason to be open. */
function unknownKeyPolicyViolations(doc: OpenApiDocument): string[] {
  const violations: string[] = [];
  for (const [label, node] of reachableObjectSchemas(doc)) {
    if (node.additionalProperties === false) continue;
    if (label in OPEN_REQUEST_BODY_SCHEMAS) continue;
    violations.push(label);
  }
  return violations.sort((a, b) => a.localeCompare(b));
}

/**
 * The all-surfaces composition with the agent-authoring flag on, so the two
 * flag-gated assist bodies are walked as well. A default build publishes neither,
 * so the committed documents alone would leave them unguarded - and they carry the
 * only nested closed objects in the whole request surface.
 */
const allSurfaces = createApp(
  makeDeps({ env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }) }),
  { public: true, internal: true, admin: true },
  { groups: appGroups },
).getOpenAPIDocument({ openapi: "3.0.3", info: { title: "all surfaces", version: "0" } });

const WALKED: ReadonlyArray<readonly [string, OpenApiDocument, number]> = [
  ["respondent", readCommitted("respondent"), 3],
  ["admin", committedAdmin, 12],
  ["all surfaces with every flag on", allSurfaces, 17],
];

describe("every request body rejects unknown keys (issue #893)", () => {
  it.each(WALKED)("%s: every object reachable from a body is closed or reasoned", (_name, doc) => {
    // The failure lists the labels, so a new body schema that forgot
    // `z.strictObject` names itself here rather than needing to be hunted.
    expect(unknownKeyPolicyViolations(doc)).toEqual([]);
  });

  it.each(WALKED)(
    "%s: walks the request bodies it is supposed to (%d of them)",
    (_name, doc, count) => {
      // Pinned so the guard cannot go quiet. A route that loses its body, or a new
      // route that gains one, moves this number and has to be looked at.
      expect(jsonRequestBodies(doc).size).toBe(count);
    },
  );

  it("an open map still says what its values are", () => {
    // The other half of the policy: `additionalProperties: false` belongs on closed
    // objects, and an open map may not answer with a bare `true` or with nothing.
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
  /** A one-route document whose body is the pre-#893 shape: a plain, open object. */
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
  // `{"unknownField": 1}` on the settings patch used to satisfy `minProperties: 1`
  // as far as a generated client could tell, while the server stripped the key and
  // refused the resulting empty patch. Both facts are now published together: one
  // property is still enough, and an undeclared property is not a property.
  const schema = (committedAdmin.components?.schemas?.["UpdateFormSettingsBody"] ?? {}) as {
    minProperties?: number;
    additionalProperties?: unknown;
  };

  it("publishes additionalProperties: false beside minProperties: 1", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.minProperties).toBe(1);
  });
});
