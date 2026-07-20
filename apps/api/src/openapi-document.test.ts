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
