import { describe, expect, it } from "vitest";

import {
  BUILDER_CONVERSATION_PREFIX,
  CONVERSATION_STORAGE_KEY,
  CONVERSATION_TURN_CAP,
  appendCapped,
  builderConversationKey,
  conversationKeysToClear,
  atSubject,
  parseConversation,
  postedTurns,
  promptTurns,
  waitingProposalTurns,
  serializeConversation,
  startConversation,
  type AgentTurnRecord,
  type ConversationState,
} from "./conversation-state";

function minting(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id_${String(next)}`;
  };
}

function state(turns: readonly AgentTurnRecord[] = []): ConversationState {
  return { id: "cnv_1", visitId: "vis_1", subject: "screen:/forms", turns, dropped: 0 };
}

function prose(count: number): readonly AgentTurnRecord[] {
  return Array.from({ length: count }, (_value, index) => ({
    role: "user" as const,
    content: `turn ${String(index)}`,
  }));
}

describe("the conversation's identity and its stays", () => {
  it("mints an id and a first stay together", () => {
    const started = startConversation("screen:/forms", minting());
    expect(started).toMatchObject({ id: "id_1", visitId: "id_2", dropped: 0, turns: [] });
  });

  it("keeps the stay while the subject holds and mints a new one when it changes", () => {
    const held = atSubject(state(), "screen:/forms", minting());
    expect(held.visitId).toBe("vis_1");

    const moved = atSubject(state(), "form:frm_a", minting());
    expect(moved).toMatchObject({ id: "cnv_1", subject: "form:frm_a", visitId: "id_1" });
  });

  it("mints a further stay when the conversation returns to a subject", () => {
    const mint = minting();
    const away = atSubject(state(), "form:frm_a", mint);
    const back = atSubject(away, "screen:/forms", mint);
    expect(back.visitId).not.toBe(away.visitId);
    expect(back.visitId).not.toBe("vis_1");
    expect(back.id).toBe("cnv_1");
  });
});

describe("the conversation's length cap", () => {
  it("keeps every turn up to the cap and counts nothing dropped", () => {
    const filled = appendCapped(state(), prose(CONVERSATION_TURN_CAP));
    expect(filled.turns).toHaveLength(CONVERSATION_TURN_CAP);
    expect(filled.dropped).toBe(0);
  });

  it("drops the oldest turns past the cap and counts them", () => {
    const filled = appendCapped(state(), prose(CONVERSATION_TURN_CAP));
    const over = appendCapped(filled, [{ role: "user", content: "the newest" }]);
    expect(over.turns).toHaveLength(CONVERSATION_TURN_CAP);
    expect(over.dropped).toBe(1);
    expect(over.turns.at(0)).toMatchObject({ content: "turn 1" });
    expect(over.turns.at(-1)).toMatchObject({ content: "the newest" });
  });
});

describe("the history a turn replays", () => {
  it("carries the dialogue and the card reports, and no panel outcome line", () => {
    expect(
      promptTurns([
        { role: "user", content: "add a step" },
        { role: "assistant", content: "done" },
        { role: "result", content: "accepted" },
        {
          role: "action-result",
          proposalId: "prp_1",
          steps: [{ kind: "form.publish", outcome: "done" }],
        },
      ]),
    ).toEqual([
      { role: "user", content: "add a step" },
      { role: "assistant", content: "done" },
      {
        role: "action-result",
        proposalId: "prp_1",
        steps: [{ kind: "form.publish", outcome: "done" }],
      },
    ]);
  });
});

describe("the history a turn posts", () => {
  const waiting = waitingProposalTurns({ proposalId: "prp_1", steps: [{ kind: "form.publish" }] });

  it("stays within the cap once the waiting card takes its slot", () => {
    const posted = postedTurns(prose(CONVERSATION_TURN_CAP), waiting);
    expect(posted).toHaveLength(CONVERSATION_TURN_CAP);
    expect(posted.at(0)).toMatchObject({ content: "turn 1" });
    expect(posted.at(-1)).toMatchObject({ role: "proposal", proposalId: "prp_1" });
  });

  it("drops nothing when no card is waiting", () => {
    const posted = postedTurns(prose(CONVERSATION_TURN_CAP), []);
    expect(posted).toHaveLength(CONVERSATION_TURN_CAP);
    expect(posted.at(0)).toMatchObject({ content: "turn 0" });
  });

  it("counts the panel's own outcome lines out before it measures the room", () => {
    const history: readonly AgentTurnRecord[] = [
      ...prose(CONVERSATION_TURN_CAP - 1),
      { role: "result", content: "accepted" },
    ];
    const posted = postedTurns(history, waiting);
    expect(posted).toHaveLength(CONVERSATION_TURN_CAP);
    expect(posted.at(0)).toMatchObject({ content: "turn 0" });
  });
});

describe("the card a turn says is waiting", () => {
  it("carries the step kinds and nothing the card displays", () => {
    expect(
      waitingProposalTurns({
        proposalId: "prp_1",
        steps: [
          { kind: "form.create", title: { en: "Patient onboarding" } },
          { kind: "form.saveDraft" },
        ] as unknown as readonly { readonly kind: string }[],
      }),
    ).toEqual([
      {
        role: "proposal",
        proposalId: "prp_1",
        steps: [{ kind: "form.create" }, { kind: "form.saveDraft" }],
      },
    ]);
  });

  it("says nothing when no card is waiting", () => {
    expect(waitingProposalTurns(undefined)).toEqual([]);
    expect(waitingProposalTurns({ proposalId: "prp_1", steps: [] })).toEqual([]);
  });
});

describe("the stored conversation", () => {
  it("comes back for the user it names", () => {
    const stored = serializeConversation(state(prose(2)), "usr_1");
    expect(parseConversation(stored, "usr_1")).toMatchObject({
      id: "cnv_1",
      visitId: "vis_1",
      turns: prose(2),
    });
  });

  it("is discarded for another user, and for no user at all", () => {
    const stored = serializeConversation(state(prose(1)), "usr_1");
    expect(parseConversation(stored, "usr_2")).toBeUndefined();
    expect(parseConversation(stored, "")).toBeUndefined();
  });

  it("is discarded when anything in it is unreadable", () => {
    expect(parseConversation("not json", "usr_1")).toBeUndefined();
    expect(parseConversation(null, "usr_1")).toBeUndefined();
    expect(
      parseConversation(
        JSON.stringify({ user: "usr_1", id: "cnv_1", visitId: "v", subject: "s", dropped: 0 }),
        "usr_1",
      ),
    ).toBeUndefined();
    expect(
      parseConversation(
        JSON.stringify({
          user: "usr_1",
          id: "cnv_1",
          visitId: "v",
          subject: "s",
          dropped: 0,
          turns: [{ role: "nonsense", content: "x" }],
        }),
        "usr_1",
      ),
    ).toBeUndefined();
  });

  it("keeps an action-result turn's allowlisted scalars and drops the rest", () => {
    const stored = JSON.stringify({
      user: "usr_1",
      id: "cnv_1",
      visitId: "v",
      subject: "s",
      dropped: 0,
      turns: [
        {
          role: "action-result",
          proposalId: "prp_1",
          steps: [
            { kind: "form.publish", outcome: "done", result: { version: 3, nested: { no: 1 } } },
          ],
        },
      ],
    });
    expect(parseConversation(stored, "usr_1")?.turns).toEqual([
      {
        role: "action-result",
        proposalId: "prp_1",
        steps: [{ kind: "form.publish", outcome: "done", result: { version: 3 } }],
      },
    ]);
  });

  it("trims a stored history longer than the cap", () => {
    const stored = JSON.stringify({
      user: "usr_1",
      id: "cnv_1",
      visitId: "v",
      subject: "s",
      dropped: 0,
      turns: prose(CONVERSATION_TURN_CAP + 5),
    });
    expect(parseConversation(stored, "usr_1")?.turns).toHaveLength(CONVERSATION_TURN_CAP);
  });
});

describe("the agent builder's conversation key", () => {
  it("differs per user, per workspace and per form", () => {
    const base = builderConversationKey("usr_1", "ws_a", "frm_a");
    expect(builderConversationKey("usr_2", "ws_a", "frm_a")).not.toBe(base);
    expect(builderConversationKey("usr_1", "ws_b", "frm_a")).not.toBe(base);
    expect(builderConversationKey("usr_1", "ws_a", "frm_b")).not.toBe(base);
    expect(builderConversationKey("usr_1", "ws_a", null)).not.toBe(base);
  });

  it("is never the dock's key, and cannot be forged into another entry by a separator", () => {
    const key = builderConversationKey("usr_1", "ws_a", "frm_a");
    expect(key).not.toBe(CONVERSATION_STORAGE_KEY);
    expect(key.startsWith(BUILDER_CONVERSATION_PREFIX)).toBe(true);
    expect(builderConversationKey("usr:1", "ws", "frm")).not.toBe(
      builderConversationKey("usr", "1:ws", "frm"),
    );
  });

  it("is cleared at sign-out with the dock's, leaving every other entry", () => {
    const builder = builderConversationKey("usr_1", "ws_a", "frm_a");
    expect(conversationKeysToClear([builder, "qcms-operations-return", null])).toEqual([
      CONVERSATION_STORAGE_KEY,
      builder,
    ]);
  });
});

describe("the builder's edit outcomes in the history", () => {
  const edits: AgentTurnRecord = {
    role: "edit-result",
    edits: [
      { op: "step", outcome: "applied" },
      { op: "copy", outcome: "undone" },
    ],
  };

  it("are replayed to the next turn and survive the tab store", () => {
    expect(promptTurns([edits])).toEqual([edits]);
    const stored = serializeConversation(state([edits]), "usr_1");
    expect(parseConversation(stored, "usr_1")?.turns).toEqual([edits]);
  });

  it("drop the whole store entry when an op or outcome is unknown", () => {
    const stored = serializeConversation(
      state([{ role: "edit-result", edits: [{ op: "publish", outcome: "applied" }] } as never]),
      "usr_1",
    );
    expect(parseConversation(stored, "usr_1")).toBeUndefined();
  });
});
