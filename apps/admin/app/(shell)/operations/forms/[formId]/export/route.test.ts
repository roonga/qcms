import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const exportCalls: Array<Record<string, unknown>> = [];

let upstreamContentType = "text/csv; charset=utf-8";

vi.mock("@/lib/server/session", () => ({
  requireAdminSessionForRequest: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/responses", () => ({
  exportResponses: (_session: unknown, _formId: string, request: Record<string, unknown>) => {
    exportCalls.push(request);
    return Promise.resolve(
      new Response("id\r\n", {
        status: 200,
        headers: { "content-type": upstreamContentType },
      }),
    );
  },
}));

const { GET } = await import("./route.ts");

function get(search: string): Promise<Response> {
  const request = {
    nextUrl: new URL(`https://admin.example.test/forms/frm_intake/export${search}`),
  } as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ formId: "frm_intake" }) });
}

async function envelope(response: Response): Promise<{
  error: { code: string; message: string; details?: { invalid?: string[] } };
}> {
  return (await response.json()) as {
    error: { code: string; message: string; details?: { invalid?: string[] } };
  };
}

beforeEach(() => {
  exportCalls.length = 0;
  upstreamContentType = "text/csv; charset=utf-8";
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
        shape: "long",
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
      'attachment; filename="frm_intake-prod-v1-responses.csv"',
    );
  });

  it("sends no filter for an absent or empty one, and exports the form", async () => {
    const response = await get("?format=csv&version=2&from=&to=");

    expect(response.status).toBe(200);
    expect(exportCalls).toEqual([{ format: "csv", shape: "long", version: "2" }]);
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

describe("export route: the CSV shape (task 075)", () => {
  it("forwards the chosen shape and defaults to long", async () => {
    await get("?format=csv&version=2&shape=wide");
    expect(exportCalls[0]).toMatchObject({ shape: "wide" });

    exportCalls.length = 0;
    await get("?format=csv&version=2");
    expect(exportCalls[0]).toMatchObject({ shape: "long" });
  });

  it("reads an unknown shape as the default rather than refusing the export", async () => {
    const response = await get("?format=csv&version=2&shape=tall");
    expect(response.status).toBe(200);
    expect(exportCalls[0]).toMatchObject({ shape: "long" });
  });

  it("names a .zip when the API answered with one", async () => {
    upstreamContentType = "application/zip";
    const response = await get("?format=csv&version=2");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="frm_intake-prod-v2-responses.zip"',
    );
  });

  it("still names a .csv for the same request when the API answered with CSV", async () => {
    const response = await get("?format=csv&version=2");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="frm_intake-prod-v2-responses.csv"',
    );
  });
});
