import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftForm } from "../forms/types.ts";

/**
 * A repeating group surviving the trip back from the API (task 074, ADR-42).
 *
 * ## The defect this file exists for
 *
 * `lib/server/forms.ts` reads the API's stored draft into the builder's working shape, and it
 * read a step's item list as "every entry carrying a `questionId`". That was total while a step
 * held nothing else. With the union it silently DROPPED every repeating group: a group survived
 * until the first reload, and then the builder opened on a step that had been emptied, with
 * autosave paused about a step the author had just filled - and the stored draft still holding
 * the group, so the next save would have deleted it.
 *
 * Nothing in the browser noticed until acceptance case 58's walk reloaded the page, which is the
 * argument for that case reloading rather than asserting the screen it had just typed into. This
 * is the same property at the layer that owns it, where the shapes can simply be handed back.
 *
 * ## What is asserted, and what is deliberately dropped
 *
 * The three count sources round-trip as declared, and **an absent `max` arrives back absent**:
 * the kernel makes it optional precisely so a half-filled draft can round-trip, so a zero here
 * would turn a required-field prompt into a group that can never have an instance.
 *
 * A count source this build cannot read drops the GROUP rather than inventing one. Inventing
 * would look tolerant and be the worst outcome available: the panel would show the invented
 * source, the next autosave would store it, and an author's `fixed` count would be gone with no
 * press to have reported it.
 */

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

/** Set per case; `adminApiFetch` answers the detail read with it. */
let detail: Record<string, unknown> = {};

/** The API's `GET /admin/forms/{id}` body, with one step holding `items`. */
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

/** One repeating group as the API stores it, with the count under test. */
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
      // Document order is preserved, which is what the forward-only cut is taken over: the pin
      // after the group's span stays after it.
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

    // The state an author is in while the required field is still empty. A zero would be a bound
    // nobody chose, and a group with max 0 can never have an instance.
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

    // Loud rather than silent: the step is short, so autosave pauses and says so, instead of the
    // panel showing an invented source the next save would store.
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

    // A group may not contain a group (Q13), so a nested one is not a member and is not carried:
    // the member list is pins, which is what makes an instance's address a pair rather than a path.
    expect(draft?.steps[0]?.items[0]).toMatchObject({
      items: [{ questionId: "q_passport", version: 1 }],
    });
  });
});
