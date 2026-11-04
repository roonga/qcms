import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftForm } from "../forms/types.ts";

const adminApiFetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify(detail), {
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

let detail: Record<string, unknown> = {};

function formDetail(items: readonly unknown[]): Record<string, unknown> {
  return {
    formId: "frm_booking",
    slug: "booking",
    defaultLocale: "en",
    status: "open",
    draftSource: "open",
    versions: [],
    settings: { challengeRequired: false, minSubmitMs: null },
    challengeEnforceable: false,
    draft: {
      formId: "frm_booking",
      defaultLocale: "en",
      title: { en: "Booking" },
      steps: [{ stepId: "stp_travellers", title: { en: "Travellers" }, items }],
      rules: [],
    },
  };
}

function group(count: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    groupId: "grp_passengers",
    label: { en: "Passengers" },
    instanceLabel: { en: "Passenger {n}" },
    items: [
      { questionId: "q_passport", version: 1 },
      { questionId: "q_fare", version: 2 },
    ],
    count,
    presentation: "stacked",
    ...extra,
  };
}

async function readDraft(items: readonly unknown[]): Promise<DraftForm | null> {
  detail = formDetail(items);
  const { getForm } = await import("./forms.ts");
  const result = await getForm(SESSION, "frm_booking");
  if (!result.ok) throw new Error("the fixture detail read should have succeeded");
  return result.data.draft;
}

beforeEach(() => {
  vi.resetModules();
  adminApiFetch.mockClear();
});

describe("reading a step's item list", () => {
  it("carries a repeating group back whole, beside the step's own pins", async () => {
    const draft = await readDraft([
      { questionId: "q_trip", version: 1 },
      group({ source: "open", min: 1, max: 9 }),
      { questionId: "q_notes", version: 3 },
    ]);

    expect(draft?.steps[0]?.items).toStrictEqual([
      { questionId: "q_trip", version: 1 },
      {
        groupId: "grp_passengers",
        label: { en: "Passengers" },
        instanceLabel: { en: "Passenger {n}" },
        items: [
          { questionId: "q_passport", version: 1 },
          { questionId: "q_fare", version: 2 },
        ],
        count: { source: "open", min: 1, max: 9 },
        presentation: "stacked",
      },

      { questionId: "q_notes", version: 3 },
    ]);
  });

  it("round-trips each of the three count sources as declared", async () => {
    const fixed = await readDraft([group({ source: "fixed", count: 3 })]);
    expect(fixed?.steps[0]?.items[0]).toMatchObject({ count: { source: "fixed", count: 3 } });

    const fromAnswer = await readDraft([
      group({ source: "fromAnswer", questionId: "q_count", min: 1, max: 9 }),
    ]);
    expect(fromAnswer?.steps[0]?.items[0]).toMatchObject({
      count: { source: "fromAnswer", questionId: "q_count", min: 1, max: 9 },
    });

    const open = await readDraft([group({ source: "open", min: 0, max: 20 })]);
    expect(open?.steps[0]?.items[0]).toMatchObject({
      count: { source: "open", min: 0, max: 20 },
    });
  });

  it("brings an absent maximum back ABSENT, not as a zero", async () => {
    const draft = await readDraft([group({ source: "open", min: 1 })]);

    expect(draft?.steps[0]?.items[0]).toMatchObject({ count: { source: "open", min: 1 } });
    const read = draft?.steps[0]?.items[0] as { count: { max?: number } } | undefined;
    expect(read?.count.max).toBeUndefined();
  });

  it("defaults a missing presentation to stacked, which is the kernel's own default", async () => {
    const draft = await readDraft([
      { ...group({ source: "open", min: 1, max: 9 }), presentation: undefined },
    ]);

    expect(draft?.steps[0]?.items[0]).toMatchObject({ presentation: "stacked" });
  });

  it("drops a group whose count source this build cannot read, and keeps the pins beside it", async () => {
    const draft = await readDraft([
      { questionId: "q_trip", version: 1 },
      group({ source: "somethingElse", min: 1 }),
      group({ source: "open" }),
      group(undefined),
    ]);

    expect(draft?.steps[0]?.items).toStrictEqual([{ questionId: "q_trip", version: 1 }]);
  });

  it("drops a malformed pin exactly as it always did", async () => {
    const draft = await readDraft([
      { questionId: "q_trip" },
      { version: 2 },
      { questionId: "q_notes", version: 3 },
    ]);

    expect(draft?.steps[0]?.items).toStrictEqual([{ questionId: "q_notes", version: 3 }]);
  });

  it("never reads a group's member list as holding another group", async () => {
    const draft = await readDraft([
      {
        ...group({ source: "open", min: 1, max: 9 }),
        items: [
          { questionId: "q_passport", version: 1 },
          group({ source: "open", min: 1, max: 2 }),
        ],
      },
    ]);

    expect(draft?.steps[0]?.items[0]).toMatchObject({
      items: [{ questionId: "q_passport", version: 1 }],
    });
  });
});
