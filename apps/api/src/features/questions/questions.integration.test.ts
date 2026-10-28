import {
  A2UI_SPEC_VERSION,
  COMPILER_VERSION,
  HONEYPOT_NODE_TYPE,
} from "@roonga/qcms-a2ui-compiler";
import { parseQuestionDefinition, QuestionId } from "@roonga/qcms-core";
import { SEED_WORKSPACE_ID, createQuestion, createQuestionVersion } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerQuestions } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerGrantCheck, registerQuestions] },
  });
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
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
  error: { code: string; message: string; details?: { issues?: unknown[]; target?: string } };
}

describe("version lifecycle walk (exit criterion 1)", () => {
  it("create → edit draft → publish → edit rejected → new version → deprecate", async () => {
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

    const editRes = await put("/questions/q_walk_colour/versions/1", {
      definition: shortText("q_walk_colour", "Best colour"),
    });
    expect(editRes.status).toBe(200);
    const edited = (await editRes.json()) as VersionBody;
    expect(edited.status).toBe("draft");
    expect(edited.definition.label?.en).toBe("Best colour");

    const pubRes = await post("/questions/q_walk_colour/versions/1/publish");
    expect(pubRes.status).toBe(200);
    const published = (await pubRes.json()) as VersionBody;
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const rejectRes = await put("/questions/q_walk_colour/versions/1", {
      definition: shortText("q_walk_colour", "Sneaky edit"),
    });
    expect(rejectRes.status).toBe(409);
    expect(((await rejectRes.json()) as ErrBody).error.code).toBe("VERSION_IMMUTABLE");

    const newVerRes = await post("/questions/q_walk_colour/versions");
    expect(newVerRes.status).toBe(201);
    const v2 = (await newVerRes.json()) as VersionBody;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v2.definition.label?.en).toBe("Best colour");

    const depRes = await post("/questions/q_walk_colour/versions/1/deprecate");
    expect(depRes.status).toBe(200);
    expect(((await depRes.json()) as VersionBody).status).toBe("deprecated");

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

describe("R6 - questionId is never reused (exit criterion 2)", () => {
  it("recreating a deprecated question's id is rejected; a fresh id is fine", async () => {
    expect(
      (await post("/questions", { slug: "reuse-a", definition: shortText("q_reuse") })).status,
    ).toBe(201);
    await post("/questions/q_reuse/versions/1/publish");
    await post("/questions/q_reuse/versions/1/deprecate");

    const reused = await post("/questions", { slug: "reuse-b", definition: shortText("q_reuse") });
    expect(reused.status).toBe(409);
    expect(((await reused.json()) as ErrBody).error.code).toBe("QUESTION_ID_REUSED");

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
      definition: { questionId: "q_edit_bad", type: "shortText" },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_QUESTION_DEFINITION");
  });
});

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

  it("returns the latest-version summary with its label and type", async () => {
    const body = (await (await get("/questions")).json()) as {
      questions: Array<{
        questionId: string;
        latestStatus: string;
        label?: { en?: string };
        type?: string;
      }>;
    };
    const apple = body.questions.find((q) => q.questionId === "q_list_apple");
    expect(apple?.latestStatus).toBe("published");
    expect(apple?.label?.en).toBe("Apple");
    expect(apple?.type).toBe("shortText");
  });

  it("filters by the latest version's type", async () => {
    await post("/questions", {
      slug: "list-cherry-count",
      definition: {
        questionId: "q_list_cherry_count",
        type: "number",
        label: { en: "Cherries" },
      },
    });

    const numbers = (await (await get("/questions?type=number")).json()) as {
      questions: Array<{ questionId: string; type: string }>;
    };
    expect(numbers.questions.map((q) => q.questionId)).toContain("q_list_cherry_count");
    expect(numbers.questions.every((q) => q.type === "number")).toBe(true);
    expect(numbers.questions.some((q) => q.questionId === "q_list_apple")).toBe(false);

    const shortTexts = (await (await get("/questions?type=shortText")).json()) as {
      questions: Array<{ questionId: string }>;
    };
    expect(shortTexts.questions.map((q) => q.questionId)).toContain("q_list_apple");
  });

  it("combines the type filter with status and search", async () => {
    const body = (await (
      await get("/questions?type=shortText&status=draft&search=banana")
    ).json()) as {
      questions: Array<{ questionId: string }>;
    };
    expect(body.questions.map((q) => q.questionId)).toEqual(["q_list_banana"]);
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

  it("accepts a search term at the 200-character bound", async () => {
    const res = await get(`/questions?search=${"a".repeat(200)}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { questions: unknown[] }).questions).toEqual([]);
  });

  it("refuses a longer one with a 400 in the standard envelope, before the handler", async () => {
    const res = await get(`/questions?search=${"a".repeat(201)}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.details).toMatchObject({ target: "query" });
  });

  it("keeps the refused term itself out of the response (SEC-8)", async () => {
    const res = await get(`/questions?search=${"SENTINELsearchvalue".repeat(20)}`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("SENTINEL");
  });

  describe("?versions=all", () => {
    beforeAll(async () => {
      await post("/questions", {
        slug: "list-damson",
        definition: shortText("q_list_damson", "Damson"),
      });
      await post("/questions/q_list_damson/versions/1/publish");
      await post("/questions/q_list_damson/versions");
    });

    it("carries every version of every row, oldest first", async () => {
      const body = (await (await get("/questions?versions=all")).json()) as {
        questions: Array<{
          questionId: string;
          latestStatus: string;
          versions?: Array<{ version: number; status: string; definition: unknown }>;
        }>;
      };
      const damson = body.questions.find((q) => q.questionId === "q_list_damson");

      expect(damson?.latestStatus).toBe("draft");
      expect(damson?.versions?.map((v) => [v.version, v.status])).toEqual([
        [1, "published"],
        [2, "draft"],
      ]);
      expect(damson?.versions?.[0]?.definition).toMatchObject({ type: "shortText" });
      expect(body.questions.every((q) => Array.isArray(q.versions))).toBe(true);
    });

    it("still reports the same summary fields it always did", async () => {
      const body = (await (await get("/questions?versions=all")).json()) as {
        questions: Array<{ questionId: string; latestStatus: string; label?: { en?: string } }>;
      };
      const apple = body.questions.find((q) => q.questionId === "q_list_apple");
      expect(apple?.latestStatus).toBe("published");
      expect(apple?.label?.en).toBe("Apple");
    });

    it("omits the key entirely when it was not asked for", async () => {
      const body = (await (await get("/questions")).json()) as {
        questions: Array<Record<string, unknown>>;
      };
      expect(body.questions.every((q) => !("versions" in q))).toBe(true);
    });

    it("composes with the existing filters", async () => {
      const body = (await (await get("/questions?versions=all&search=damson")).json()) as {
        questions: Array<{ questionId: string; versions?: unknown[] }>;
      };
      expect(body.questions.map((q) => q.questionId)).toEqual(["q_list_damson"]);
      expect(body.questions[0]?.versions).toHaveLength(2);
    });

    it("refuses a value the parameter does not define", async () => {
      expect((await get("/questions?versions=some")).status).toBe(400);
    });
  });
});

interface PreviewNode {
  type: string;
  props?: Record<string, unknown>;
  children?: PreviewNode[] | string;
}
interface PreviewBody {
  stepId: string;
  root: PreviewNode;
  a2uiSpecVersion: string;
  compilerVersion: string;
}

// A `Text` node's `children` is a string, not a list.
function childrenOf(node: PreviewNode): PreviewNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function flatten(node: PreviewNode): PreviewNode[] {
  return [node, ...childrenOf(node).flatMap(flatten)];
}

describe("GET /admin/questions/:id/versions/:v/preview (032)", () => {
  beforeAll(async () => {
    await post("/questions", {
      slug: "preview-draft",
      definition: shortText("q_preview_draft", "Draft colour"),
    });
    await post("/questions", {
      slug: "preview-published",
      definition: shortText("q_preview_published", "Published colour"),
    });
    await post("/questions/q_preview_published/versions/1/publish");
  });

  it("previews a draft: Form → Flex → the mapped control, and no honeypot decoy", async () => {
    const res = await get("/questions/q_preview_draft/versions/1/preview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;

    expect(body.stepId).toBe("stp_preview");

    expect(body.root.type).toBe("Form");
    const flex = childrenOf(body.root)[0];
    expect(flex?.type).toBe("Flex");
    expect(flex?.props?.direction).toBe("column");

    const control = childrenOf(flex ?? body.root)[0];
    expect(control?.type).toBe("TextField");
    expect(control?.props?.label).toBe("Draft colour");
    expect(control?.props?.name).toBe("q_preview_draft");

    expect(flatten(body.root).map((n) => n.type)).not.toContain(HONEYPOT_NODE_TYPE);
  });

  it("previews a published version too (the route is a read, not a draft tool)", async () => {
    const res = await get("/questions/q_preview_published/versions/1/preview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    const control = childrenOf(childrenOf(body.root)[0] ?? body.root)[0];
    expect(control?.type).toBe("TextField");
    expect(control?.props?.label).toBe("Published colour");
  });

  it("stamps the compiler and A2UI spec versions the compiler exports (ADR-18)", async () => {
    const body = (await (
      await get("/questions/q_preview_draft/versions/1/preview")
    ).json()) as PreviewBody;
    expect(body.a2uiSpecVersion).toBe(A2UI_SPEC_VERSION);
    expect(body.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("an unparseable ?locale= falls back to en rather than erroring", async () => {
    const res = await get("/questions/q_preview_draft/versions/1/preview?locale=not-a-locale");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    const control = childrenOf(childrenOf(body.root)[0] ?? body.root)[0];
    expect(control?.props?.label).toBe("Draft colour");
  });

  it("unknown question → 404 QUESTION_NOT_FOUND; unknown version → 404 VERSION_NOT_FOUND", async () => {
    const noQuestion = await get("/questions/q_preview_absent/versions/1/preview");
    expect(noQuestion.status).toBe(404);
    expect(((await noQuestion.json()) as ErrBody).error.code).toBe("QUESTION_NOT_FOUND");

    const noVersion = await get("/questions/q_preview_draft/versions/9/preview");
    expect(noVersion.status).toBe(404);
    expect(((await noVersion.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");

    const notANumber = await get("/questions/q_preview_draft/versions/abc/preview");
    expect(notANumber.status).toBe(404);
    expect(((await notANumber.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");

    // Past the `question_versions.version` int4 ceiling, which Postgres itself would
    // refuse as out of range if the value reached it.
    const overRange = await get("/questions/q_preview_draft/versions/2147483648/preview");
    expect(overRange.status).toBe(404);
    expect(((await overRange.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");
  });

  it("a malformed question id → 400 INVALID_QUESTION_ID", async () => {
    const res = await get("/questions/not-a-q-id/versions/1/preview");
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrBody).error.code).toBe("INVALID_QUESTION_ID");
  });
});

// Browsers compile the HTML `pattern` attribute with the `v` flag, whose character-class
// grammar is narrower than the `u` semantics the kernel validates against.
describe("v-invalid patterns are refused at the authoring boundary (#53)", () => {
  const V_INVALID = "^[A-Za-z][A-Za-z .,'-]{0,99}$";
  const V_SAFE = "^[A-Za-z][A-Za-z .,'\\-]{0,99}$";

  function withPattern(id: string, pattern: string): Record<string, unknown> {
    return { ...shortText(id), constraints: { pattern } };
  }

  function issuesOf(body: ErrBody): Array<{ code: string; message: string; path?: unknown[] }> {
    return (body.error.details?.issues ?? []) as Array<{
      code: string;
      message: string;
      path?: unknown[];
    }>;
  }

  it("refuses a NEW definition, naming why and offering the v-safe spelling", async () => {
    const res = await post("/questions", {
      slug: "v-new",
      definition: withPattern("q_v_new", V_INVALID),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("INVALID_QUESTION_DEFINITION");
    const issue = issuesOf(body).find((i) => i.code === "PATTERN_NOT_BROWSER_SAFE");
    expect(issue).toBeDefined();
    expect(issue?.path).toEqual(["constraints", "pattern"]);
    expect(issue?.message).toContain("'v'");
    expect(issue?.message).toContain(V_SAFE);
  });

  it("refuses an EDITED definition on the same terms", async () => {
    expect(
      (await post("/questions", { slug: "v-edit", definition: shortText("q_v_edit") })).status,
    ).toBe(201);

    const res = await put("/questions/q_v_edit/versions/1", {
      definition: withPattern("q_v_edit", V_INVALID),
    });

    expect(res.status).toBe(422);
    const issue = issuesOf((await res.json()) as ErrBody).find(
      (i) => i.code === "PATTERN_NOT_BROWSER_SAFE",
    );
    expect(issue).toBeDefined();
  });

  it("accepts the v-safe spelling the refusal suggested", async () => {
    const res = await post("/questions", {
      slug: "v-accepted",
      definition: withPattern("q_v_accepted", V_SAFE),
    });
    expect(res.status).toBe(201);
  });

  it("refuses without a suggestion when no rewrite is provably safe", async () => {
    // A mid-class dash is a range operator under `u`, so escaping it could change the
    // matched set; the normalization declines rather than guess.
    const res = await post("/questions", {
      slug: "v-no-fix",
      definition: withPattern("q_v_no_fix", "^[a-z-A]+$"),
    });

    expect(res.status).toBe(422);
    const issue = issuesOf((await res.json()) as ErrBody).find(
      (i) => i.code === "PATTERN_NOT_BROWSER_SAFE",
    );
    expect(issue?.message).toContain("No equivalent spelling");
  });

  it("leaves a non-shortText question alone: the rule is about patterns", async () => {
    const res = await post("/questions", {
      slug: "v-not-text",
      definition: { questionId: "q_v_bool", type: "boolean", label: { en: "Yes or no" } },
    });
    expect(res.status).toBe(201);
  });

  it("STORED v-invalid content still reads and still serves (R1, reject-new-only)", async () => {
    // Seeded past the authoring boundary, as content stored before the rule existed is.
    const questionId = QuestionId.parse("q_v_legacy");
    const parsed = parseQuestionDefinition(withPattern("q_v_legacy", V_INVALID));
    if (!parsed.ok) throw new Error("legacy fixture did not parse");
    await createQuestion(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      questionId,
      slug: "v-legacy",
    });
    await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });

    const read = await get("/questions/q_v_legacy");
    expect(read.status).toBe(200);
    const detail = (await read.json()) as {
      versions: { version: number; definition: { constraints?: { pattern?: string } } }[];
    };
    const stored = detail.versions.find((v) => v.version === 1);
    expect(stored?.definition.constraints?.pattern).toBe(V_INVALID);

    const preview = await get("/questions/q_v_legacy/versions/1/preview");
    expect(preview.status).toBe(200);
  });

  it.each([
    ["core fixtures/questions/valid/short-text.json", "^[A-Za-z][A-Za-z .,'-]{0,99}$"],
    ["a2ui-compiler fixtures/corpus/questions/q-msg-plate.json", "^[A-Z0-9][A-Z0-9-]{2,7}$"],
    ["api e2e/support/fixtures/q-am-plate.json", "^[A-Z0-9][A-Z0-9-]{2,7}$"],
  ])("the pattern in %s would be refused if authored fresh", async (where, pattern) => {
    const slug = `v-fixture-${where.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 60);
    const id = `q_v_fx_${Math.abs(hashOf(where)).toString(36)}`;
    const res = await post("/questions", { slug, definition: withPattern(id, pattern) });

    expect(res.status).toBe(422);
    expect(issuesOf((await res.json()) as ErrBody).map((i) => i.code)).toContain(
      "PATTERN_NOT_BROWSER_SAFE",
    );
  });
});

function hashOf(value: string): number {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return hash;
}
