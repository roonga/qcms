/**
 * Admin question-authoring slice tests (task 021), driven through `app.request()`
 * against the **real** kernel and the 013 Testcontainers harness DB - never a
 * mock of our own packages (CONTRIBUTING). Requires Docker.
 *
 * Covers every exit criterion:
 *  1. the version lifecycle walk (create → edit draft → publish → edit rejected
 *     → new version → deprecate) and every invalid transition;
 *  2. R6 - recreate-after-deprecate with the same id is rejected, a new id is fine;
 *  3. malformed definitions return 422 with the kernel's coded issues and paths;
 *  4. (the auth-seam 401 and public-only 404 are the no-DB `admin-mount.test.ts`).
 */

import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { registerQuestions } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerQuestions] } });
  internalToken = internalTokenFor(deps.config);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers (channel token + stub admin session on every call) -----

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: "editor-1",
    ...extra,
  };
}

async function post(path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "POST",
    headers: authHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return app.request(`/admin${path}`, { headers: authHeaders() });
}

// --- fixtures ---------------------------------------------------------------

function shortText(id: string, labelText = "Favourite colour"): Record<string, unknown> {
  return { questionId: id, type: "shortText", label: { en: labelText } };
}

interface VersionBody {
  questionId: string;
  version: number;
  status: "draft" | "published" | "deprecated";
  definition: { label?: Record<string, string> };
  publishedAt: string | null;
}
interface ErrBody {
  error: { code: string; message: string; details?: { issues?: unknown[] } };
}

// --- exit criterion 1: the lifecycle walk -----------------------------------

describe("version lifecycle walk (exit criterion 1)", () => {
  it("create → edit draft → publish → edit rejected → new version → deprecate", async () => {
    // create
    const createRes = await post("/questions", {
      slug: "walk-colour",
      definition: shortText("q_walk_colour"),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { questionId: string; version: VersionBody };
    expect(created.questionId).toBe("q_walk_colour");
    expect(created.version.version).toBe(1);
    expect(created.version.status).toBe("draft");
    expect(created.version.publishedAt).toBeNull();

    // edit draft (in place)
    const editRes = await put("/questions/q_walk_colour/versions/1", {
      definition: shortText("q_walk_colour", "Best colour"),
    });
    expect(editRes.status).toBe(200);
    const edited = (await editRes.json()) as VersionBody;
    expect(edited.status).toBe("draft");
    expect(edited.definition.label?.en).toBe("Best colour");

    // publish
    const pubRes = await post("/questions/q_walk_colour/versions/1/publish");
    expect(pubRes.status).toBe(200);
    const published = (await pubRes.json()) as VersionBody;
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    // edit rejected - published is immutable (before the DB trigger)
    const rejectRes = await put("/questions/q_walk_colour/versions/1", {
      definition: shortText("q_walk_colour", "Sneaky edit"),
    });
    expect(rejectRes.status).toBe(409);
    expect(((await rejectRes.json()) as ErrBody).error.code).toBe("VERSION_IMMUTABLE");

    // new version - seeded from the latest (carries "Best colour")
    const newVerRes = await post("/questions/q_walk_colour/versions");
    expect(newVerRes.status).toBe(201);
    const v2 = (await newVerRes.json()) as VersionBody;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v2.definition.label?.en).toBe("Best colour");

    // deprecate the published v1 (existing pins/history untouched)
    const depRes = await post("/questions/q_walk_colour/versions/1/deprecate");
    expect(depRes.status).toBe(200);
    expect(((await depRes.json()) as VersionBody).status).toBe("deprecated");

    // the detail view now shows both versions, oldest first
    const detail = (await (await get("/questions/q_walk_colour")).json()) as {
      slug: string;
      versions: VersionBody[];
    };
    expect(detail.slug).toBe("walk-colour");
    expect(detail.versions.map((x) => [x.version, x.status])).toEqual([
      [1, "deprecated"],
      [2, "draft"],
    ]);
  });
});

// --- exit criterion 1: invalid transitions ----------------------------------

describe("invalid transitions (exit criterion 1)", () => {
  async function seed(id: string, slug: string): Promise<void> {
    const res = await post("/questions", { slug, definition: shortText(id) });
    expect(res.status).toBe(201);
  }

  it("editing a deprecated version → 409 VERSION_IMMUTABLE", async () => {
    await seed("q_dep_edit", "dep-edit");
    await post("/questions/q_dep_edit/versions/1/publish");
    await post("/questions/q_dep_edit/versions/1/deprecate");
    const res = await put("/questions/q_dep_edit/versions/1", {
      definition: shortText("q_dep_edit", "nope"),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("VERSION_IMMUTABLE");
  });

  it("publishing an already-published version → 409 INVALID_VERSION_STATE", async () => {
    await seed("q_double_pub", "double-pub");
    await post("/questions/q_double_pub/versions/1/publish");
    const res = await post("/questions/q_double_pub/versions/1/publish");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_VERSION_STATE");
  });

  it("publishing a deprecated version → 409 INVALID_VERSION_STATE", async () => {
    await seed("q_pub_dep", "pub-dep");
    await post("/questions/q_pub_dep/versions/1/publish");
    await post("/questions/q_pub_dep/versions/1/deprecate");
    const res = await post("/questions/q_pub_dep/versions/1/publish");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_VERSION_STATE");
  });

  it("deprecating a draft version → 409 INVALID_VERSION_STATE", async () => {
    await seed("q_dep_draft", "dep-draft");
    const res = await post("/questions/q_dep_draft/versions/1/deprecate");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_VERSION_STATE");
  });

  it("deprecating an already-deprecated version → 409 INVALID_VERSION_STATE", async () => {
    await seed("q_double_dep", "double-dep");
    await post("/questions/q_double_dep/versions/1/publish");
    await post("/questions/q_double_dep/versions/1/deprecate");
    const res = await post("/questions/q_double_dep/versions/1/deprecate");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_VERSION_STATE");
  });

  it("acting on a missing version/question → 404", async () => {
    await seed("q_notfound", "notfound");
    expect((await post("/questions/q_notfound/versions/9/publish")).status).toBe(404);
    expect((await post("/questions/q_notfound/versions/9/deprecate")).status).toBe(404);
    expect(
      (await put("/questions/q_notfound/versions/9", { definition: shortText("q_notfound") }))
        .status,
    ).toBe(404);
    expect((await get("/questions/q_missing_entirely")).status).toBe(404);
    expect((await post("/questions/q_missing_entirely/versions")).status).toBe(404);
  });
});

// --- exit criterion 2: R6 (ids never reused) --------------------------------

describe("R6 - questionId is never reused (exit criterion 2)", () => {
  it("recreating a deprecated question's id is rejected; a fresh id is fine", async () => {
    // create → publish → deprecate the whole lifecycle for q_reuse
    expect(
      (await post("/questions", { slug: "reuse-a", definition: shortText("q_reuse") })).status,
    ).toBe(201);
    await post("/questions/q_reuse/versions/1/publish");
    await post("/questions/q_reuse/versions/1/deprecate");

    // same id, different slug → QUESTION_ID_REUSED even though it's deprecated
    const reused = await post("/questions", { slug: "reuse-b", definition: shortText("q_reuse") });
    expect(reused.status).toBe(409);
    expect(((await reused.json()) as ErrBody).error.code).toBe("QUESTION_ID_REUSED");

    // a brand-new id is fine
    const fresh = await post("/questions", {
      slug: "reuse-c",
      definition: shortText("q_reuse_new"),
    });
    expect(fresh.status).toBe(201);
  });

  it("a duplicate slug on a new id is a clean 409 SLUG_TAKEN, not a 500", async () => {
    expect(
      (await post("/questions", { slug: "dup-slug", definition: shortText("q_slug_a") })).status,
    ).toBe(201);
    const clash = await post("/questions", { slug: "dup-slug", definition: shortText("q_slug_b") });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as ErrBody).error.code).toBe("SLUG_TAKEN");
  });
});

// --- exit criterion 3: malformed definitions (kernel paths intact) ----------

describe("malformed definitions → 422 with kernel issues (exit criterion 3)", () => {
  it("a structurally invalid definition returns INVALID_QUESTION_DEFINITION with issues", async () => {
    const res = await post("/questions", {
      slug: "bad-missing-type",
      definition: { questionId: "q_bad_type", label: { en: "No type" } },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("INVALID_QUESTION_DEFINITION");
    expect(Array.isArray(body.error.details?.issues)).toBe(true);
    expect((body.error.details?.issues ?? []).length).toBeGreaterThan(0);
  });

  it("a kernel constraint code and path survive into the envelope (duplicate optionId)", async () => {
    const res = await post("/questions", {
      slug: "bad-dup-option",
      definition: {
        questionId: "q_bad_option",
        type: "singleChoice",
        label: { en: "Pick one" },
        options: [
          { optionId: "opt_x", label: { en: "X" } },
          { optionId: "opt_x", label: { en: "X again" } },
        ],
      },
    });
    expect(res.status).toBe(422);
    const issues = (((await res.json()) as ErrBody).error.details?.issues ?? []) as Array<{
      code: string;
      path?: (string | number)[];
    }>;
    const dup = issues.find((i) => i.code === "DUPLICATE_OPTION_ID");
    expect(dup).toBeDefined();
    expect(dup?.path).toContain("options");
  });

  it("an invalid questionId format is rejected by the kernel (422)", async () => {
    const res = await post("/questions", {
      slug: "bad-id",
      definition: shortText("not-a-q-id"),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_QUESTION_DEFINITION");
  });

  it("editing a draft with a mismatched questionId is rejected (422 QUESTION_ID_MISMATCH)", async () => {
    expect(
      (await post("/questions", { slug: "mismatch", definition: shortText("q_mismatch") })).status,
    ).toBe(201);
    const res = await put("/questions/q_mismatch/versions/1", {
      definition: shortText("q_other_id"),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrBody).error.code).toBe("QUESTION_ID_MISMATCH");
  });

  it("a malformed draft edit surfaces kernel issues (422), not a 500", async () => {
    expect(
      (await post("/questions", { slug: "edit-bad", definition: shortText("q_edit_bad") })).status,
    ).toBe(201);
    const res = await put("/questions/q_edit_bad/versions/1", {
      definition: { questionId: "q_edit_bad", type: "shortText" }, // missing label
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_QUESTION_DEFINITION");
  });
});

// --- list: status filter + slug/label search --------------------------------

describe("GET /admin/questions - summary, status filter, search", () => {
  beforeAll(async () => {
    await post("/questions", {
      slug: "list-apple",
      definition: shortText("q_list_apple", "Apple"),
    });
    await post("/questions", {
      slug: "list-banana",
      definition: shortText("q_list_banana", "Banana"),
    });
    await post("/questions/q_list_apple/versions/1/publish");
  });

  it("returns the latest-version summary with its label", async () => {
    const body = (await (await get("/questions")).json()) as {
      questions: Array<{ questionId: string; latestStatus: string; label?: { en?: string } }>;
    };
    const apple = body.questions.find((q) => q.questionId === "q_list_apple");
    expect(apple?.latestStatus).toBe("published");
    expect(apple?.label?.en).toBe("Apple");
  });

  it("filters by latest status", async () => {
    const body = (await (await get("/questions?status=draft")).json()) as {
      questions: Array<{ questionId: string; latestStatus: string }>;
    };
    expect(body.questions.every((q) => q.latestStatus === "draft")).toBe(true);
    expect(body.questions.some((q) => q.questionId === "q_list_banana")).toBe(true);
    expect(body.questions.some((q) => q.questionId === "q_list_apple")).toBe(false);
  });

  it("searches by slug and by label", async () => {
    const bySlug = (await (await get("/questions?search=banana")).json()) as {
      questions: Array<{ questionId: string }>;
    };
    expect(bySlug.questions.map((q) => q.questionId)).toContain("q_list_banana");

    const byLabel = (await (await get("/questions?search=apple")).json()) as {
      questions: Array<{ questionId: string }>;
    };
    expect(byLabel.questions.map((q) => q.questionId)).toContain("q_list_apple");
  });
});
