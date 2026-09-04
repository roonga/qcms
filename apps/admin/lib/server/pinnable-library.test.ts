import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What opening the form builder costs the API (issue #684).
 *
 * The builder's question picker needs every version an author could pin, and the list
 * route's default summary reports only the latest. So `loadPinnableQuestions` read the
 * whole library and then issued `GET /questions/{id}` once per row to assemble the
 * version lists: `1 + N` requests on every builder page load, N being the entire library,
 * with no filter, no limit and no pagination anywhere on the path. A three-hundred
 * question library meant three hundred and one round trips before the author had opened
 * the picker at all.
 *
 * `?versions=all` is the route answering the question directly, so the count is the
 * subject of this file rather than a footnote to it: what is asserted is the number of
 * requests and the path of the one that is made.
 */

/** Every path the BFF asked the API for, in order. */
const requested: string[] = [];

const adminApiFetch = vi.fn((_session: unknown, path: string) => {
  requested.push(path);
  const body = path.startsWith("/questions") ? library : {};
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok",
};

/** One list row, in the shape `?versions=all` returns. */
function row(questionId: string, versions: unknown): Record<string, unknown> {
  return {
    questionId,
    slug: questionId.replace(/^q_/u, "").replaceAll("_", "-"),
    createdAt: "2026-09-01T00:00:00.000Z",
    latestVersion: 2,
    latestStatus: "draft",
    publishedAt: null,
    label: { en: questionId },
    type: "shortText",
    ...(versions === undefined ? {} : { versions }),
  };
}

/** A published v1 under a draft v2: the shape the summary alone cannot report. */
const TWO_VERSIONS = [
  { version: 1, status: "published", definition: { type: "shortText" } },
  { version: 2, status: "draft", definition: { type: "shortText" } },
];

/** Set per case; `adminApiFetch` answers the list read with it. */
let library: { questions: unknown[] } = { questions: [] };

async function loadLibrary(): Promise<unknown> {
  const { loadPinnableQuestions } = await import("./forms.ts");
  return loadPinnableQuestions(SESSION);
}

describe("loadPinnableQuestions", () => {
  beforeEach(() => {
    requested.length = 0;
    adminApiFetch.mockClear();
    library = { questions: [row("q_one", TWO_VERSIONS), row("q_two", TWO_VERSIONS)] };
  });

  it("makes one request for the whole library, not one per question", async () => {
    await loadLibrary();

    expect(requested).toEqual(["/questions?versions=all"]);
  });

  it("still makes one request as the library grows, which is the point", async () => {
    library = {
      questions: Array.from({ length: 50 }, (_unused, index) =>
        row(`q_${String(index)}`, TWO_VERSIONS),
      ),
    };

    const result = (await loadLibrary()) as { ok: boolean; data: readonly unknown[] };

    expect(requested).toHaveLength(1);
    expect(result.data).toHaveLength(50);
  });

  it("carries the published version sitting under a draft, which is why it asks", async () => {
    const result = (await loadLibrary()) as {
      ok: boolean;
      data: readonly { questionId: string; versions: readonly { version: number }[] }[];
    };

    expect(result.ok).toBe(true);
    expect(result.data[0]?.versions).toEqual(TWO_VERSIONS);
  });

  it("drops a row carrying no versions rather than failing the screen", async () => {
    // The tolerance the detail-read fan-out had, kept and moved: a library the author can
    // mostly use beats a builder that will not open.
    library = { questions: [row("q_one", undefined), row("q_two", TWO_VERSIONS)] };

    const result = (await loadLibrary()) as {
      ok: boolean;
      data: readonly { questionId: string }[];
    };

    expect(result.data.map((question) => question.questionId)).toEqual(["q_two"]);
  });

  it("fails the call when the one read fails, because nothing is left to show", async () => {
    adminApiFetch.mockImplementationOnce((_session: unknown, path: string) => {
      requested.push(path);
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "UPSTREAM" } }), { status: 503 }),
      );
    });

    const result = (await loadLibrary()) as { ok: boolean };

    expect(result.ok).toBe(false);
  });
});
