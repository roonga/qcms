import { beforeEach, describe, expect, it, vi } from "vitest";

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
  mustChangePassword: false,
  token: "tok",
};

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

const TWO_VERSIONS = [
  { version: 1, status: "published", definition: { type: "shortText" } },
  { version: 2, status: "draft", definition: { type: "shortText" } },
];

let library: { questions: unknown[] } = { questions: [] };

async function loadLibrary(workspaceId?: string): Promise<unknown> {
  const { loadPinnableQuestions } = await import("./forms.ts");
  return loadPinnableQuestions(SESSION, workspaceId);
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

  it("asks for the form's own workspace and the shared library beside it", async () => {
    await loadLibrary("org_home");

    expect(requested).toEqual(["/questions?versions=all&workspaceId=org_home&shared=include"]);
  });

  it("tags the rows the shared library owns, and only those", async () => {
    library = {
      questions: [
        { ...row("q_mine", TWO_VERSIONS), workspaceId: "org_home" },
        { ...row("q_shared", TWO_VERSIONS), workspaceId: "org_library" },
      ],
    };

    const result = (await loadLibrary("org_home")) as {
      data: readonly { questionId: string; shared: boolean }[];
    };

    expect(result.data.map((question) => [question.questionId, question.shared])).toEqual([
      ["q_mine", false],
      ["q_shared", true],
    ]);
  });

  it("claims nothing about sharing when no workspace was named", async () => {
    const result = (await loadLibrary()) as { data: readonly { shared: boolean }[] };

    expect(result.data.every((question) => question.shared === false)).toBe(true);
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
