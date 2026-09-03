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

/** The session read, counted where it leaves this app: one call, one round trip. */
const proxiedSession = vi.fn(() => Promise.resolve(SESSION_BODY));

/** Every credentialed API call, so a path can be attributed to the screen that made it. */
const adminApiFetch = vi.fn((_session: unknown, path: string) =>
  Promise.resolve(
    new Response(
      JSON.stringify(path.endsWith("/draft/validate") ? { valid: true, issues: [] } : FORM_BODY),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
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
