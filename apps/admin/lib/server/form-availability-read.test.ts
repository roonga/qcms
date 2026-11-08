import { beforeEach, describe, expect, it, vi } from "vitest";

const adminApiFetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ),
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION: Parameters<typeof import("./forms.ts").getForm>[0] = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

let body: Record<string, unknown> = {};

async function readStatus(status: unknown): Promise<string> {
  body = { formId: "frm_trip", slug: "trip", defaultLocale: "en", status, versions: [] };
  vi.resetModules();
  const { getForm } = await import("./forms.ts");
  const result = await getForm(SESSION, "frm_trip");
  if (!result.ok) throw new Error("expected the detail read to succeed");
  return result.data.status;
}

beforeEach(() => {
  adminApiFetch.mockClear();
});

describe("the detail read's availability", () => {
  it.each(["open", "closed", "unreleased"] as const)("carries %s through", async (status) => {
    expect(await readStatus(status)).toBe(status);
  });

  it("falls back to open for a reading it cannot recognise", async () => {
    expect(await readStatus("archived")).toBe("open");
    expect(await readStatus(undefined)).toBe("open");
  });
});
