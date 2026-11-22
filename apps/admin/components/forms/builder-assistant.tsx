"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/kit";
import {
  AssistantConversation,
  type BuilderTurnHooks,
} from "@/components/agent/assistant-conversation";
import type { AcceptOutcome, BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import {
  applyTurnEdits,
  editResultTurn,
  recordKey,
  replaceRecord,
  undoEdit,
  undoableKey,
  type EditPorts,
  type EditRecord,
  type EditRecordState,
} from "@/lib/agent/builder-edits";
import { useConversation } from "@/lib/agent/conversation";
import type { ConversationScreen } from "@/lib/agent/screens";
import { builderPublishHref } from "@/lib/forms/build-return";
import type { BuilderEditOp } from "@/lib/forms/assist-stream";
import type { AgentEditState, StoredDraftState } from "@/lib/forms/builder-state";
import type { DraftForm } from "@/lib/forms/types";
import { t, type MessageKey } from "@/lib/i18n/en";
import { builderPath } from "@/lib/shell/modes";

const OP_LABELS: Readonly<Record<BuilderEditOp, MessageKey>> = {
  question: "builder.edit.op.question",
  step: "builder.edit.op.step",
  rule: "builder.edit.op.rule",
  copy: "builder.edit.op.copy",
  appearance: "builder.edit.op.appearance",
};

const STATE_LABELS: Readonly<Record<EditRecordState, MessageKey>> = {
  applying: "builder.edit.state.applying",
  applied: "builder.edit.state.applied",
  failed: "builder.edit.state.failed",
  "not-run": "builder.edit.state.notRun",
  undoing: "builder.edit.state.undoing",
  undone: "builder.edit.state.undone",
};

/* The agent builder carries no apply-draft step: its edits are card-less. */
function noAccept(): Promise<AcceptOutcome> {
  return Promise.resolve({ saved: false, message: t("agent.card.note.noBuilder") });
}

function noop(): void {
  return undefined;
}

function noteFor(record: EditRecord): string | undefined {
  if (record.state === "failed") return t("builder.edit.failed", { message: record.message ?? "" });
  if (record.state === "not-run") return t("builder.edit.notRun");
  if (record.undoMessage === undefined) return undefined;
  return t("builder.edit.undoFailed", { message: record.undoMessage });
}

function EditRow({
  record,
  number,
  undoable,
  busy,
  onUndo,
}: {
  readonly record: EditRecord;
  readonly number: number;
  readonly undoable: boolean;
  readonly busy: boolean;
  readonly onUndo: () => void;
}) {
  const what = t(OP_LABELS[record.op]);
  const note = noteFor(record);
  return (
    <li className="qcms-builder-edit" data-state={record.state} data-testid="qcms-builder-edit">
      <div className="qcms-builder-edit__row">
        <span className="qcms-builder-edit__what">{what}</span>
        <span className="qcms-tag qcms-tag--draft" data-testid="qcms-builder-edit-state">
          {t(STATE_LABELS[record.state])}
        </span>
        {record.state === "applied" && record.undoToken !== undefined && (
          <Button variant="secondary" size="sm" isDisabled={!undoable || busy} onPress={onUndo}>
            {t("builder.edit.undo")}
            <span className="sr-only">
              {`, ${t("builder.edit.undoName", { edit: what, number: String(number) })}`}
            </span>
          </Button>
        )}
      </div>
      {note !== undefined && <p className="qcms-builder-edit__note">{note}</p>}
    </li>
  );
}

/** The server actions an existing form's builder saves its edits through, bound to that form. */
export interface BuilderEditActions {
  readonly apply: (
    definition: unknown,
    token: string,
    appearance?: unknown,
  ) => Promise<AgentEditState>;
  readonly readStored: () => Promise<StoredDraftState>;
}

/** The agent builder's assistant: the dock's conversation, with its edits applied card-less. */
export function BuilderAssistant({
  formId,
  workspaceId,
  draft,
  actions,
}: {
  readonly formId: string | null;
  readonly workspaceId: string;
  readonly draft: DraftForm | null;
  readonly actions: BuilderEditActions | undefined;
}): ReactNode {
  const router = useRouter();
  const conversation = useConversation();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [records, setRecords] = useState<readonly EditRecord[]>([]);
  const recordsRef = useRef<readonly EditRecord[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const changeRecords = useCallback((next: readonly EditRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const screen = useMemo<ConversationScreen>(
    () =>
      formId === null
        ? { screen: "/forms/new", params: workspaceId === "" ? {} : { workspaceId } }
        : { screen: "/forms/[formId]/build", params: { formId } },
    [formId, workspaceId],
  );

  const snapshot = useMemo<BuilderAssistSnapshot | undefined>(
    () =>
      formId === null || draft === null
        ? undefined
        : {
            endpoint: `/forms/${encodeURIComponent(formId)}/assist`,
            canPropose: true,
            draft,
            draftUpdatedAt: undefined,
            accept: noAccept,
          },
    [draft, formId],
  );

  const ports = useMemo<EditPorts | undefined>(
    () =>
      actions === undefined
        ? undefined
        : {
            readStored: async () => {
              const stored = await actions.readStored();
              return stored.status === "read"
                ? { definition: stored.definition, appearance: stored.appearance }
                : undefined;
            },
            save: (definition, token, appearance) => actions.apply(definition, token, appearance),
          },
    [actions],
  );

  const undo = useCallback(
    async (key: string) => {
      const record = recordsRef.current.find((candidate) => recordKey(candidate) === key);
      if (ports === undefined || record === undefined || undoableKey(recordsRef.current) !== key) {
        return;
      }
      setUndoing(true);
      changeRecords(replaceRecord(recordsRef.current, { ...record, state: "undoing" }));
      const settled = await undoEdit(record, ports.save);
      changeRecords(replaceRecord(recordsRef.current, settled));
      setUndoing(false);
      if (settled.state === "undone") {
        const turn = editResultTurn([settled]);
        if (turn !== undefined) conversation.append([turn]);
        setAnnouncement(t("builder.edit.announce.undone"));
        router.refresh();
      }
    },
    [changeRecords, conversation, ports, router],
  );

  const hooks = useMemo<BuilderTurnHooks>(
    () => ({
      applyEdits: async (event) => {
        if (ports === undefined || event.formId !== formId) return;
        const earlier = recordsRef.current;
        const settled = await applyTurnEdits(event, ports, (turnRecords) => {
          changeRecords([...earlier, ...turnRecords]);
        });
        const turn = editResultTurn(settled);
        if (turn !== undefined) conversation.append([turn]);
        setAnnouncement(
          settled.every((record) => record.state === "applied")
            ? t("builder.edit.announce.applied")
            : t("builder.edit.announce.failed"),
        );
        router.refresh();
      },
      renderEdits: (turnId) => {
        const shown = records.filter((record) => record.turnId === turnId);
        const top = undoableKey(records);
        return (
          <ol className="qcms-builder-edits" aria-label={t("builder.edit.listLabel")}>
            {shown.map((record) => {
              const key = recordKey(record);
              return (
                <EditRow
                  key={key}
                  record={record}
                  number={records.indexOf(record) + 1}
                  undoable={top === key}
                  busy={undoing}
                  onUndo={() => void undo(key)}
                />
              );
            })}
          </ol>
        );
      },
      openWizard: (returnTo) => {
        if (formId === null || returnTo !== builderPath(formId)) return;
        router.push(builderPublishHref(formId));
      },
      onFormCreated: (created) => {
        if (formId !== null) return;
        conversation.restart();
        router.push(builderPath(created));
      },
    }),
    [changeRecords, conversation, formId, ports, records, router, undo, undoing],
  );

  return (
    <>
      <AssistantConversation
        screen={screen}
        environment=""
        conversation={conversation}
        builder={snapshot}
        composerRef={composerRef}
        onWorkingChange={noop}
        onAnnounce={setAnnouncement}
        turnHooks={hooks}
      />
      <p className="sr-only" aria-live="polite" data-testid="qcms-builder-announce">
        {announcement}
      </p>
    </>
  );
}
