import type { AgentEditState } from "../forms/builder-state";
import type { BuilderEditOp, BuilderEdits } from "../forms/assist-stream";

import type { EditResultTurn } from "./conversation-state";

export type EditRecordState = "applying" | "applied" | "failed" | "not-run" | "undoing" | "undone";

/** One card-less edit as the builder holds it. `pre` and `undoToken` are what its Undo sends. */
export interface EditRecord {
  readonly turnId: string;
  readonly index: number;
  readonly op: BuilderEditOp;
  readonly state: EditRecordState;
  readonly pre?: unknown;
  readonly undoToken?: string;
  readonly message?: string;
  readonly undoMessage?: string;
}

export interface EditPorts {
  /** The stored draft before the turn's first edit, which that edit's Undo restores. */
  readonly readStored: () => Promise<unknown>;
  readonly save: (definition: unknown, token: string) => Promise<AgentEditState>;
}

export function recordKey(record: Pick<EditRecord, "turnId" | "index">): string {
  return `${record.turnId}:${String(record.index)}`;
}

export function replaceRecord(
  records: readonly EditRecord[],
  next: EditRecord,
): readonly EditRecord[] {
  const key = recordKey(next);
  return records.map((record) => (recordKey(record) === key ? next : record));
}

/**
 * Applies one turn's edits in order, each definition exactly as the turn sent it, since its
 * token binds that post-state. The first refusal stops the rest: each later token binds the
 * revision the refused one would have left.
 */
export async function applyTurnEdits(
  event: BuilderEdits,
  ports: EditPorts,
  onChange: (records: readonly EditRecord[]) => void,
): Promise<readonly EditRecord[]> {
  let records: readonly EditRecord[] = event.edits.map((edit) => ({
    turnId: event.turnId,
    index: edit.index,
    op: edit.op,
    state: "applying",
  }));
  onChange(records);
  let before: unknown = await ports.readStored().catch(() => undefined);
  let stopped = false;
  for (const edit of event.edits) {
    const current = records.find((record) => record.index === edit.index);
    if (current === undefined) continue;
    if (stopped) {
      records = replaceRecord(records, { ...current, state: "not-run" });
      continue;
    }
    const saved = await ports
      .save(edit.definition, edit.token)
      .catch((): AgentEditState => ({ status: "error", code: "UNREACHABLE", message: "" }));
    if (saved.status === "error") {
      records = replaceRecord(records, { ...current, state: "failed", message: saved.message });
      stopped = true;
    } else {
      records = replaceRecord(records, {
        ...current,
        state: "applied",
        ...(before === undefined || saved.undoToken === null
          ? {}
          : { pre: before, undoToken: saved.undoToken }),
      });
      before = edit.definition;
    }
    onChange(records);
  }
  onChange(records);
  return records;
}

const SETTLED_ABOVE: readonly EditRecordState[] = ["undone", "failed", "not-run"];

/**
 * The one edit an Undo may take now: the newest applied edit, once every later one is undone
 * or never applied. Undo restores the state before its own edit, so it works latest first.
 */
export function undoableKey(records: readonly EditRecord[]): string | undefined {
  for (let at = records.length - 1; at >= 0; at -= 1) {
    const record = records[at];
    if (record === undefined) continue;
    if (SETTLED_ABOVE.includes(record.state)) continue;
    if (record.state !== "applied" || record.undoToken === undefined) return undefined;
    return recordKey(record);
  }
  return undefined;
}

export async function undoEdit(record: EditRecord, save: EditPorts["save"]): Promise<EditRecord> {
  if (record.undoToken === undefined || record.pre === undefined) return record;
  const saved = await save(record.pre, record.undoToken).catch((): AgentEditState => ({
    status: "error",
    code: "UNREACHABLE",
    message: "",
  }));
  if (saved.status === "error") {
    return {
      turnId: record.turnId,
      index: record.index,
      op: record.op,
      state: record.state,
      undoMessage: saved.message,
      ...(record.message === undefined ? {} : { message: record.message }),
    };
  }
  return { ...record, state: "undone" };
}

const OUTCOMES: Readonly<
  Record<EditRecordState, EditResultTurn["edits"][number]["outcome"] | undefined>
> = {
  applying: undefined,
  undoing: undefined,
  applied: "applied",
  failed: "failed",
  "not-run": "not-run",
  undone: "undone",
};

/** The next turn's account of these edits, in ops and outcomes only. */
export function editResultTurn(records: readonly EditRecord[]): EditResultTurn | undefined {
  const edits = records.flatMap((record) => {
    const outcome = OUTCOMES[record.state];
    return outcome === undefined ? [] : [{ op: record.op, outcome }];
  });
  return edits.length === 0 ? undefined : { role: "edit-result", edits };
}
