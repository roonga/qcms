import { beforeEach, describe, expect, it, vi } from "vitest";

const memo = { enabled: true };

function memoized<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const root = new Map<unknown, unknown>();
  return (...args: A): R => {
    let node = root;
    for (const arg of args) {
      let next = node.get(arg) as Map<unknown, unknown> | undefined;
      if (next === undefined) {
        next = new Map<unknown, unknown>();
        node.set(arg, next);
      }
      node = next;
    }
    if (!node.has(RESULT)) node.set(RESULT, fn(...args));
    return node.get(RESULT) as R;
  };
}

const RESULT = Symbol("result");

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache: <A extends readonly unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) =>
    memo.enabled ? memoized(fn) : fn,
}));

const FORM_ID = "frm_intake";

const SESSION_BODY = {
  session: { token: "tok", createdAt: new Date().toISOString() },
  user: { id: "usr_1", email: "admin@example.test", name: "Admin", twoFactorEnabled: true },
};

const FORM_BODY = {
  formId: FORM_ID,
  slug: "intake",
  defaultLocale: "en",
  status: "open",
  draft: {
    formId: FORM_ID,
    slug: "intake",
    defaultLocale: "en",
    title: { en: "Intake" },
    steps: [{ stepId: "stp_one", title: { en: "One" }, pins: [] }],
    rules: [],
  },
  versions: [],
  settings: {},
  challengeEnforceable: true,
};

const QUESTION_ID = "qst_email";

const QUESTION_BODY = {
  questionId: QUESTION_ID,
  slug: "email",
  createdAt: "2026-01-01T00:00:00.000Z",
  versions: [
    {
      questionId: QUESTION_ID,
      version: 1,
      status: "published",
      definition: { type: "shortText", label: { en: "Email" } },
      publishedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
};

const PREVIEW_BODY = {};

function bodyFor(path: string): unknown {
  if (path.endsWith("/draft/validate")) return { valid: true, issues: [] };
  if (path.endsWith("/preview")) return PREVIEW_BODY;
  if (path.startsWith("/questions/")) return QUESTION_BODY;

  if (isFormsList(path)) return { forms: [] };
  return FORM_BODY;
}

function isFormsList(path: string): boolean {
  return path === "/forms" || path.startsWith("/forms?");
}

const proxiedSession = vi.fn(() => Promise.resolve(SESSION_BODY));

const adminApiFetch = vi.fn((_session: unknown, path: string) =>
  Promise.resolve(
    new Response(JSON.stringify(bodyFor(path)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ),
);

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect to ${path}`);
  },
}));
vi.mock("./auth-api.ts", () => ({ proxiedSession }));
vi.mock("./api.ts", () => ({ adminApiFetch }));

interface RenderReads {
  readonly sessionReads: number;
  readonly formReads: number;
  readonly validations: number;
}

async function renderFormScreen(): Promise<RenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { getForm } = await import("./forms.ts");
  const { loadFormRail } = await import("./form-rail.ts");

  await requireAdminSession();

  const pageSession = await requireAdminSession();
  await getForm(pageSession, FORM_ID);

  const railSession = await requireAdminSession();
  await loadFormRail(railSession, FORM_ID);

  const paths = adminApiFetch.mock.calls.map(([, path]) => path);
  return {
    sessionReads: proxiedSession.mock.calls.length,
    formReads: paths.filter((path) => path === `/forms/${FORM_ID}`).length,
    validations: paths.filter((path) => path.endsWith("/draft/validate")).length,
  };
}

interface QuestionRenderReads {
  readonly sessionReads: number;
  readonly questionReads: number;
  readonly previews: number;
}

async function renderQuestionScreen(): Promise<QuestionRenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { getPreview, getQuestion } = await import("./questions.ts");
  const { loadQuestionRail } = await import("./question-rail.ts");

  await requireAdminSession();

  const pageSession = await requireAdminSession();
  const detail = await getQuestion(pageSession, QUESTION_ID);
  const selected = detail.ok ? (detail.data.versions.at(-1)?.version ?? 1) : 1;
  await getPreview(pageSession, QUESTION_ID, selected);

  const railSession = await requireAdminSession();
  await loadQuestionRail(railSession, QUESTION_ID);

  const paths = adminApiFetch.mock.calls.map(([, path]) => path);
  return {
    sessionReads: proxiedSession.mock.calls.length,
    questionReads: paths.filter((path) => path === `/questions/${QUESTION_ID}`).length,
    previews: paths.filter((path) => path.endsWith("/preview")).length,
  };
}

describe("the server reads one render of a form-scoped screen makes", () => {
  beforeEach(() => {
    memo.enabled = true;
  });

  it("asks for the session once and the form once", async () => {
    expect(await renderFormScreen()).toEqual({
      sessionReads: 1,
      formReads: 1,
      validations: 1,
    });
  });

  it("made six calls for the same four answers before the request memo", async () => {
    memo.enabled = false;
    expect(await renderFormScreen()).toEqual({
      sessionReads: 3,
      formReads: 2,
      validations: 1,
    });
  });

  it("still runs the draft validation per render, which is not a duplicate", async () => {
    const { validations } = await renderFormScreen();
    expect(validations).toBe(1);
  });
});

describe("the server reads one render of the question detail screen makes", () => {
  beforeEach(() => {
    memo.enabled = true;
  });

  it("asks for the session once and the question once", async () => {
    expect(await renderQuestionScreen()).toEqual({
      sessionReads: 1,
      questionReads: 1,
      previews: 1,
    });
  });

  it("made six calls for the same three answers before the request memo", async () => {
    memo.enabled = false;
    expect(await renderQuestionScreen()).toEqual({
      sessionReads: 3,
      questionReads: 2,
      previews: 1,
    });
  });

  it("still compiles the selected version's preview per render, which is not a duplicate", async () => {
    const { previews } = await renderQuestionScreen();
    expect(previews).toBe(1);
  });
});

interface ListRenderReads {
  readonly sessionReads: number;
  readonly listReads: number;

  readonly listPaths: readonly string[];
}

async function renderFormsListScreen(
  search: Record<string, string> = {},
): Promise<ListRenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { listForms } = await import("./forms.ts");

  await requireAdminSession();

  const pageSession = await requireAdminSession();
  await listForms(pageSession, search);

  const paths = adminApiFetch.mock.calls.map(([, path]) => path);
  return {
    sessionReads: proxiedSession.mock.calls.length,
    listReads: paths.filter(isFormsList).length,
    listPaths: paths.filter(isFormsList),
  };
}

describe("the server reads one render of the form library list makes (issue 686)", () => {
  beforeEach(() => {
    memo.enabled = true;
  });

  it("asks for the session once and the list once", async () => {
    const reads = await renderFormsListScreen();
    expect(reads.sessionReads).toBe(1);
    expect(reads.listReads).toBe(1);
  });

  it("still makes exactly one list request once the three filters are on", async () => {
    const reads = await renderFormsListScreen({
      search: "vehicle",
      status: "closed",
      sort: "published-desc",
    });

    expect(reads.sessionReads).toBe(1);
    expect(reads.listReads).toBe(1);
  });

  it("carries the filters on the query string, which is where the cost of them is", async () => {
    const { listPaths } = await renderFormsListScreen({
      search: "vehicle",
      status: "closed",
      sort: "published-desc",
    });

    const [path = ""] = listPaths;
    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(Object.fromEntries(query)).toEqual({
      search: "vehicle",
      status: "closed",
      sort: "published-desc",
    });
  });

  it("sends no query string at all when it is asked for no filters", async () => {
    expect((await renderFormsListScreen()).listPaths).toEqual(["/forms"]);
  });

  it("made two session calls for one answer before the request memo", async () => {
    memo.enabled = false;
    const reads = await renderFormsListScreen();
    expect(reads.sessionReads).toBe(2);
    expect(reads.listReads).toBe(1);
  });
});
