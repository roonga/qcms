import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How many server reads one render of a form-scoped screen costs (issue #626).
 *
 * ## What the number was, and why it was three questions asked six times
 *
 * A Next layout, the page it wraps and a `@rail` parallel slot are three separate React
 * trees rendered for one request, and none of them can hand a value to another. So each
 * asked for itself: `app/(shell)/layout.tsx` reads the session, the page reads the
 * session and the form, and `@rail/forms/[formId]/rail-slot.tsx` reads the session, the
 * form again, and the draft verdict. Six API round trips for four distinct answers, and
 * `POST .../draft/validate` - the one that is genuinely per render - runs the API's
 * `compileDraft` over every pinned question version.
 *
 * Two of the six were duplicates of an answer the same request already had. The session
 * duplicate predates the rail entirely: the shell layout and every page have both called
 * `requireAdminSession()` since task 031. The third is not a duplicate and is left
 * alone - a verdict is per render by definition, and caching it across requests would be
 * this app deciding what the API decides (R2).
 *
 * ## Why this test stands in for React's request scope
 *
 * `cache()` memoizes per REQUEST, and a request scope only exists inside a real RSC
 * render: called from plain Node, React's own `cache` runs the function every time
 * (measured, not assumed - three calls, three invocations). So a test that imported the
 * real thing would report today's numbers whatever the code did, which is the one
 * failure mode a regression test must not have.
 *
 * What is substituted is therefore the SCOPE and nothing else: `memoized` below is an
 * ordinary argument-keyed memo standing in for the per-request one, and the module graph
 * is re-imported per case so each "render" starts with an empty memo. That makes the
 * subject of this test our own code - whether both reads actually route through the memo
 * boundary - rather than React's semantics, which are React's contract. Delete the
 * `cache()` from either `currentAdminSession` or `getForm` and the counts below go back
 * to six, because the substitute can only dedupe a call that passes through it.
 *
 * The `memo` switch is what makes this a measurement rather than an assertion: the same
 * render is counted with the memo inert (which is exactly the shipped behaviour before
 * this change) and with it live.
 *
 * ## The same arithmetic one screen over (issue #808)
 *
 * The question detail screen is the same three trees around a different resource: the
 * layout reads the session, `questions/[questionId]/page.tsx` reads the session, the
 * question and the selected version's preview, and `@rail/questions/[questionId]/page.tsx`
 * reads the session and, through `loadQuestionRail`, the question again. Six round trips
 * for three distinct answers. #626 fixed the form side and stopped there because its issue
 * covered form-scoped screens; `getQuestion` now memoizes at its own definition the way
 * `getForm` does, and the second describe below counts it the same way.
 *
 * The preview is this screen's `validateDraft`: a different resource rather than a
 * duplicate, asked for once per render, and left alone.
 *
 * ## The list screen, and the number a filter must not change (issue 686)
 *
 * The third describe counts the form LIBRARY list rather than a form-scoped screen, and
 * it is here rather than in a file of its own because it is the same measurement at the
 * same seam. Its subject is different, though: not a duplicate to remove, but a count to
 * hold still while the screen gains search, a status filter and a sort. Those are the
 * API's parameters, so applying them grows the query string and nothing else. A screen
 * that reached for a second read - an unfiltered list to count against, a total, a
 * per-row lookup - would show up here immediately, which is what the issue asked for
 * when it said the pin must not regress.
 */

/** Whether the stand-in memo is live for the next module import. */
const memo = { enabled: true };

/**
 * An argument-keyed memo, in the shape `cache()` has: same arguments in a scope, one
 * invocation. Nested maps rather than a serialized key, so an object argument is matched
 * by identity the way React matches it - which is the property `getForm(session, formId)`
 * depends on, and the reason memoizing the session and memoizing the form are one change
 * rather than two.
 */
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

/** The sentinel key a memo node stores its own result under, distinct from any argument. */
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

/**
 * The preview body is never read here, only counted: `getPreview` casts what it receives
 * and this file's subject is which paths left the app, not what came back on them.
 */
const PREVIEW_BODY = {};

/** Which fixture a path gets back, so one mock serves both screens. */
function bodyFor(path: string): unknown {
  if (path.endsWith("/draft/validate")) return { valid: true, issues: [] };
  if (path.endsWith("/preview")) return PREVIEW_BODY;
  if (path.startsWith("/questions/")) return QUESTION_BODY;
  // The library list, with or without a query string: the same route either way, which
  // is the property the forms-list count below is about.
  if (isFormsList(path)) return { forms: [] };
  return FORM_BODY;
}

/** Whether a path is the form library list rather than one form's detail read. */
function isFormsList(path: string): boolean {
  return path === "/forms" || path.startsWith("/forms?");
}

/** The session read, counted where it leaves this app: one call, one round trip. */
const proxiedSession = vi.fn(() => Promise.resolve(SESSION_BODY));

/** Every credentialed API call, so a path can be attributed to the screen that made it. */
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

/** What one render of a form-scoped screen asked the server for. */
interface RenderReads {
  readonly sessionReads: number;
  readonly formReads: number;
  readonly validations: number;
}

/**
 * Render one form-scoped screen's three server trees, in the order Next renders them,
 * and count what left the app.
 *
 * The trees are the real call sequences rather than the components: the layout's guard,
 * the page's guard plus its form read, and the rail slot's guard plus `loadFormRail`.
 * Calling the components themselves would add JSX and a dozen unrelated stubs without
 * changing a single read, and the reads are the subject.
 */
async function renderFormScreen(): Promise<RenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { getForm } = await import("./forms.ts");
  const { loadFormRail } = await import("./form-rail.ts");

  // app/(shell)/layout.tsx
  await requireAdminSession();

  // app/(shell)/forms/[formId]/versions/page.tsx, and its seven siblings
  const pageSession = await requireAdminSession();
  await getForm(pageSession, FORM_ID);

  // app/(shell)/@rail/forms/[formId]/rail-slot.tsx
  const railSession = await requireAdminSession();
  await loadFormRail(railSession, FORM_ID);

  const paths = adminApiFetch.mock.calls.map(([, path]) => path);
  return {
    sessionReads: proxiedSession.mock.calls.length,
    formReads: paths.filter((path) => path === `/forms/${FORM_ID}`).length,
    validations: paths.filter((path) => path.endsWith("/draft/validate")).length,
  };
}

/** What one render of the question detail screen asked the server for. */
interface QuestionRenderReads {
  readonly sessionReads: number;
  readonly questionReads: number;
  readonly previews: number;
}

/**
 * Render the question detail screen's three server trees and count what left the app.
 *
 * The page's preview read is deliberately driven by the question it just read, the way
 * `selectVersion` drives it on the real screen: the second read of the question is the
 * thing under measurement, so the sequence has to be the one the screen actually runs
 * rather than two independent calls that happen to use the same id.
 */
async function renderQuestionScreen(): Promise<QuestionRenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { getPreview, getQuestion } = await import("./questions.ts");
  const { loadQuestionRail } = await import("./question-rail.ts");

  // app/(shell)/layout.tsx
  await requireAdminSession();

  // app/(shell)/questions/[questionId]/page.tsx
  const pageSession = await requireAdminSession();
  const detail = await getQuestion(pageSession, QUESTION_ID);
  const selected = detail.ok ? (detail.data.versions.at(-1)?.version ?? 1) : 1;
  await getPreview(pageSession, QUESTION_ID, selected);

  // app/(shell)/@rail/questions/[questionId]/page.tsx
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

/** What one render of the form library list asked the server for. */
interface ListRenderReads {
  readonly sessionReads: number;
  readonly listReads: number;
  /** The paths the list route was called on, so a query string can be asserted. */
  readonly listPaths: readonly string[];
}

/**
 * Render the form library list's server trees and count what left the app (issue 686).
 *
 * Two trees, not three: `@rail/forms/page.tsx` re-exports `NoRailSection`, so the list
 * screen's rail reads nothing at all. The layout guard and the page's own guard plus its
 * one list read are the whole render.
 *
 * The subject is the arithmetic the filters must not change. Search, status and sort are
 * the API's parameters, so applying them grows the query string and nothing else; a
 * screen that had reached for a second read (a count, an unfiltered list to compare
 * against, a per-row lookup) would show up here as a number above one.
 */
async function renderFormsListScreen(
  search: Record<string, string> = {},
): Promise<ListRenderReads> {
  vi.resetModules();
  proxiedSession.mockClear();
  adminApiFetch.mockClear();

  const { requireAdminSession } = await import("./session.ts");
  const { listForms } = await import("./forms.ts");

  // app/(shell)/layout.tsx
  await requireAdminSession();

  // app/(shell)/forms/page.tsx
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

  it("sends no query string at all when nothing is filtered", async () => {
    // Not `?search=&status=&sort=`: an empty parameter is a value the API would have to
    // decide about, and the unfiltered library should ask the plain route.
    expect((await renderFormsListScreen()).listPaths).toEqual(["/forms"]);
  });

  it("made two session calls for one answer before the request memo", async () => {
    memo.enabled = false;
    const reads = await renderFormsListScreen();
    expect(reads.sessionReads).toBe(2);
    expect(reads.listReads).toBe(1);
  });
});
