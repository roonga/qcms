import { describe, expect, it, vi } from "vitest";

import type { AgentEditState } from "../forms/builder-state";
import type { BuilderEdits } from "../forms/assist-stream";

import {
  applyTurnEdits,
  editResultTurn,
  recordKey,
  replaceRecord,
  undoEdit,
  undoableKey,
  type EditRecord,
} from "./builder-edits";

const STORED = { formId: "frm_a", title: { en: "Stored" } };
const STORED_LOOK = { face: "system", corners: "subtle" };
const HELD = { definition: STORED, appearance: STORED_LOOK };

function turn(count: number, turnId = "edt_turnone"): BuilderEdits {
  return {
    formId: "frm_a",
    turnId,
    edits: Array.from({ length: count }, (_, index) => ({
      index,
      op: index === 0 ? "step" : "copy",
      token: `tok_${String(index)}`,
      definition: { formId: "frm_a", title: { en: `Edit ${String(index)}` }, z: 1, a: 2 },
    })),
  };
}

function saved(undoToken: string): AgentEditState {
  return { status: "saved", undoToken };
}

describe("applying a turn's edits", () => {
  it("sends each edit's own definition object, untouched, with its own token, in order", async () => {
    const event = turn(3);
    const save = vi.fn((_definition: unknown, token: string) =>
      Promise.resolve(saved(`undo_${token}`)),
    );
    const records = await applyTurnEdits(
      event,
      { readStored: () => Promise.resolve(HELD), save },
      () => undefined,
    );
    expect(save.mock.calls.map(([, token]) => token)).toEqual(["tok_0", "tok_1", "tok_2"]);
    for (const [index, [definition]] of save.mock.calls.entries()) {
      expect(definition).toBe(event.edits[index]?.definition);
    }
    expect(records.map((record) => record.state)).toEqual(["applied", "applied", "applied"]);
    expect(records.map((record) => record.pre)).toEqual([
      STORED,
      event.edits[0]?.definition,
      event.edits[1]?.definition,
    ]);
  });

  it("stops at an AGENT_EDIT_MISMATCH refusal and tries none of the later edits", async () => {
    const save = vi
      .fn<(definition: unknown, token: string) => Promise<AgentEditState>>()
      .mockResolvedValueOnce(saved("undo_0"))
      .mockResolvedValueOnce({
        status: "error",
        code: "AGENT_EDIT_MISMATCH",
        message: "That save is not the draft the assistant's edit produced.",
      });
    const records = await applyTurnEdits(
      turn(3),
      { readStored: () => Promise.resolve(HELD), save },
      () => undefined,
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(records.map((record) => record.state)).toEqual(["applied", "failed", "not-run"]);
    expect(records[1]?.message).toContain("not the draft");
    expect(editResultTurn(records)).toEqual({
      role: "edit-result",
      edits: [
        { op: "step", outcome: "applied" },
        { op: "copy", outcome: "failed" },
        { op: "copy", outcome: "not-run" },
      ],
    });
  });

  it("offers no Undo for the first edit when the stored draft could not be read", async () => {
    const records = await applyTurnEdits(
      turn(1),
      {
        readStored: () => Promise.reject(new Error("down")),
        save: () => Promise.resolve(saved("u")),
      },
      () => undefined,
    );
    expect(records[0]?.state).toBe("applied");
    expect(records[0]?.undoToken).toBeUndefined();
    expect(undoableKey(records)).toBeUndefined();
  });
});

describe("Undo", () => {
  async function applied(): Promise<readonly EditRecord[]> {
    return applyTurnEdits(
      turn(3),
      {
        readStored: () => Promise.resolve(HELD),
        save: (_definition, token) => Promise.resolve(saved(`undo_${token}`)),
      },
      () => undefined,
    );
  }

  it("takes the latest applied edit first, then the one before it", async () => {
    let records = await applied();
    const [first, second, third] = records;
    if (first === undefined || second === undefined || third === undefined) throw new Error();
    expect(undoableKey(records)).toBe(recordKey(third));

    const save = vi.fn(() => Promise.resolve(saved("unused")));
    records = replaceRecord(records, await undoEdit(third, save));
    expect(save).toHaveBeenLastCalledWith(third.pre, "undo_tok_2", third.preAppearance);
    expect(undoableKey(records)).toBe(recordKey(second));

    records = replaceRecord(records, await undoEdit(second, save));
    expect(save).toHaveBeenLastCalledWith(second.pre, "undo_tok_1", second.preAppearance);
    expect(first.pre).toBe(STORED);
    expect(undoableKey(records)).toBe(recordKey(first));
  });

  it("works once: a refused Undo spends its control and says why", async () => {
    const records = await applied();
    const last = records.at(-1);
    if (last === undefined) throw new Error();
    const refused = await undoEdit(last, () =>
      Promise.resolve({
        status: "error",
        code: "AGENT_EDIT_REPLAYED",
        message: "That edit token does not authorise this request.",
      }),
    );
    expect(refused.state).toBe("applied");
    expect(refused.undoToken).toBeUndefined();
    expect(refused.undoMessage).toContain("does not authorise");
    expect(undoableKey(replaceRecord(records, refused))).toBeUndefined();
  });

  it("reports an Undo to the next turn as undone", async () => {
    const records = await applied();
    const last = records.at(-1);
    if (last === undefined) throw new Error();
    const undone = await undoEdit(last, () => Promise.resolve(saved("x")));
    expect(editResultTurn([undone])).toEqual({
      role: "edit-result",
      edits: [{ op: "copy", outcome: "undone" }],
    });
  });
});

const LOOK = { face: "lexend", corners: "rounded" };

function appearanceTurn(): BuilderEdits {
  return {
    formId: "frm_a",
    turnId: "edt_look",
    edits: [
      {
        index: 0,
        op: "appearance",
        token: "tok_look",
        definition: STORED,
        appearance: LOOK,
      },
    ],
  };
}

describe("an appearance edit", () => {
  it("saves the appearance beside the definition the turn left", async () => {
    const save = vi.fn((_definition: unknown, token: string, _appearance?: unknown) =>
      Promise.resolve(saved(`undo_${token}`)),
    );
    const records = await applyTurnEdits(
      appearanceTurn(),
      { readStored: () => Promise.resolve(HELD), save },
      () => undefined,
    );
    expect(save.mock.calls).toStrictEqual([[STORED, "tok_look", LOOK]]);
    expect(records[0]?.state).toBe("applied");
  });

  it("restores the appearance that was stored when it is undone", async () => {
    const records = await applyTurnEdits(
      appearanceTurn(),
      {
        readStored: () => Promise.resolve(HELD),
        save: (_definition, token) => Promise.resolve(saved(`undo_${token}`)),
      },
      () => undefined,
    );
    const only = records[0];
    if (only === undefined) throw new Error();
    expect(only.preAppearance).toBe(STORED_LOOK);
    const save = vi.fn(() => Promise.resolve(saved("unused")));
    await undoEdit(only, save);
    expect(save).toHaveBeenLastCalledWith(STORED, "undo_tok_look", STORED_LOOK);
  });
});
