import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The export download's filter parsing (issue 551).
 *
 * ## What this pins
 *
 * The route used to hand `version`, `from` and `to` to the API exactly as they arrived,
 * which is what the response browser did before issue 521 replaced it with a validated
 * parse. Two paths asking the same question of the same three parameters and answering
 * it differently is what produces divergence later, so both now read the validators in
 * `lib/ops/response-filters.ts` and agree on what a filter is.
 *
 * They deliberately disagree on what happens to a value that is *not* one, and the
 * three refusal tests below are that decision written down: the browser drops it and
 * says so in a notice, the export refuses outright. An export has no notice to render,
 * and its product is a file that outlives the URL that made it - a CSV silently wider
 * than the range its requester asked for is a false claim someone keeps, which is worse
 * than the error they would have read immediately.
 *
 * ## Why this layer
 *
 * A route handler has no rendered surface, so no browser assertion can see which query
 * string reached the API. Calling the exported `GET` with the upstream call stubbed and
 * asserting over both the request it built and the `Response` it returned is the
 * highest layer that can see either (ADR-23's "highest layer that exists for it"). The
 * pure parser underneath is pinned separately in `lib/ops/ops.test.ts`.
 *
 * ## Red-first
 *
 * Against the pre-change route: the four refusal tests fail (`GET` answered 200 and
 * called the API, because an unparseable value was forwarded verbatim), the
 * canonicalization test fails (`?version=0001` travelled as `0001` and named the file
 * `frm_intake-v0001-responses.csv`), and the bare-day test fails (`from=2026-07-01`
 * travelled unwidened). The two control tests - a valid dialog-shaped range, and no
 * filters at all - passed before and must still pass, because a fix that refused
 * everything would satisfy the refusals and destroy the route.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** Every upstream call this file's `GET` makes, in order, with its filter argument. */
const exportCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/ops/export", () => import("../../../../../lib/ops/export"));
vi.mock("@/lib/ops/response-filters", () => import("../../../../../lib/ops/response-filters"));
vi.mock("@/lib/server/session", () => ({
  requireAdminSessionForRequest: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/responses", () => ({
  exportResponses: (_session: unknown, _formId: string, request: Record<string, unknown>) => {
    exportCalls.push(request);
    return Promise.resolve(
      new Response("id\r\n", {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    );
  },
}));

const { GET } = await import("./route.ts");

/** A GET at the export route, carrying `search` verbatim. */
function get(search: string): Promise<Response> {
  const request = {
    nextUrl: new URL(`https://admin.example.test/forms/frm_intake/export${search}`),
  } as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ formId: "frm_intake" }) });
}

/** The refusal's envelope, which is the API's own shape (`{ error: { code, message } }`). */
async function envelope(response: Response): Promise<{
  error: { code: string; message: string; details?: { invalid?: string[] } };
}> {
  return (await response.json()) as {
    error: { code: string; message: string; details?: { invalid?: string[] } };
  };
}

beforeEach(() => {
  exportCalls.length = 0;
});

describe("export route: what it forwards", () => {
  it("widens the dialog's range and keeps the version", async () => {
    const response = await get(
      "?format=csv&version=2&from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z",
    );

    expect(response.status).toBe(200);
    expect(exportCalls).toEqual([
      {
        format: "csv",
        version: "2",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T23:59:59.999Z",
      },
    ]);
  });

  it("takes a bare day and widens it, so a hand-typed range is the dialog's range", async () => {
    await get("?format=csv&version=2&from=2026-07-01&to=2026-07-31");

    expect(exportCalls[0]).toMatchObject({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.999Z",
    });
  });

  it("canonicalizes the version, so the file is named for the version it holds", async () => {
    const response = await get("?format=csv&version=0001");

    expect(exportCalls[0]).toMatchObject({ version: "1" });
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="frm_intake-v1-responses.csv"',
    );
  });

  it("sends no filter for an absent or empty one, and exports the form", async () => {
    const response = await get("?format=csv&version=2&from=&to=");

    expect(response.status).toBe(200);
    expect(exportCalls).toEqual([{ format: "csv", version: "2" }]);
  });
});

describe("export route: what it refuses", () => {
  it("refuses an unreadable day rather than exporting a wider file than was asked for", async () => {
    const response = await get("?format=csv&version=2&from=nonsense");

    expect(response.status).toBe(400);
    expect(exportCalls).toEqual([]);
    const body = await envelope(response);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(body.error.details?.invalid).toEqual(["from"]);
  });

  it("refuses a day that does not exist, which Date would roll into the next month", async () => {
    const response = await get("?format=csv&version=2&to=2026-02-31");

    expect(response.status).toBe(400);
    expect(exportCalls).toEqual([]);
    expect((await envelope(response)).error.details?.invalid).toEqual(["to"]);
  });

  it("refuses a version that is not a version number", async () => {
    const response = await get("?format=csv&version=abc");

    expect(response.status).toBe(400);
    expect(exportCalls).toEqual([]);
    expect((await envelope(response)).error.details?.invalid).toEqual(["version"]);
  });

  it("refuses an instant that is not a whole day's edge, and names every bad parameter", async () => {
    const response = await get("?format=csv&version=x&from=2026-07-01T12:00:00.000Z");

    expect(response.status).toBe(400);
    expect(exportCalls).toEqual([]);
    expect((await envelope(response)).error.details?.invalid).toEqual(["version", "from"]);
  });

  /**
   * The narrowing to whole days rejects input the API would have served, so the refusal
   * has to be actionable without reading this app's source. The instant spelling is
   * named on purpose: a caller who sent one needs to learn that instants are accepted at
   * a day's edges, not that they are rejected outright, which is what a bare
   * "must be YYYY-MM-DD" would tell them.
   */
  it("says what each rejected parameter should have looked like", async () => {
    const response = await get("?format=csv&version=x&to=2026-07-31T12:00:00.000Z");

    const { error } = await envelope(response);
    expect(error.message).toContain("version must be a positive whole number");
    expect(error.message).toContain("to must be a whole UTC day (YYYY-MM-DD)");
    expect(error.message).toContain("the instant it ends (YYYY-MM-DDT23:59:59.999Z)");
  });

  it("names the beginning of the day for from, not the end", async () => {
    const response = await get("?format=csv&version=1&from=2026-07-01T12:00:00.000Z");

    expect((await envelope(response)).error.message).toContain(
      "from must be a whole UTC day (YYYY-MM-DD), or the instant it begins (YYYY-MM-DDT00:00:00.000Z).",
    );
  });

  it("offers no download with the refusal, so nothing lands in a downloads folder", async () => {
    const response = await get("?format=csv&version=2&from=nonsense");

    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});
