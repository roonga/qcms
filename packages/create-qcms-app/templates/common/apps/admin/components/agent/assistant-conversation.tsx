"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { AssistMarkdown } from "@/components/forms/assist-markdown";
import { AssistPanel } from "@/components/forms/assist-panel";
import { Button } from "@/components/kit";
import type { BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import type { ConversationHandle } from "@/lib/agent/conversation";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { readAssistEvents } from "@/lib/forms/assist-stream";
import {
  applyTurnEvent,
  EMPTY_TURN,
  finishTurn,
  runningStep,
  turnText,
  type AssistantTurnView,
} from "@/lib/forms/assist-turn";
import { t } from "@/lib/i18n/en";

/**
 * The conversation inside the panel.
 *
 * On a form screen with a builder mounted this is the builder's own panel in its hosted
 * mode, so the draft proposal, its diff and its Accept keep working exactly as they
 * shipped while the dock draws the header; everywhere else it is the explain-and-navigate
 * conversation, which has nothing to propose until action kinds arrive.
 *
 * A turn sends the screen id, the route's own ids and the conversation id, and never
 * context content: the API computes what the screen can see under the caller's own grants.
 */
export function AssistantConversation({
  screen,
  conversation,
  builder,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly conversation: ConversationHandle;
  readonly builder: BuilderAssistSnapshot | undefined;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onWorkingChange: (working: boolean) => void;
  readonly onAnnounce: (message: string) => void;
}) {
  if (builder !== undefined) {
    return (
      <AssistPanel
        hosted
        endpoint={builder.endpoint}
        draft={builder.draft}
        draftUpdatedAt={builder.draftUpdatedAt}
        onAccept={builder.accept}
        onWorkingChange={onWorkingChange}
        onStatusChange={onAnnounce}
      />
    );
  }
  return (
    <ScreenConversation
      screen={screen}
      conversation={conversation}
      composerRef={composerRef}
      onWorkingChange={onWorkingChange}
      onAnnounce={onAnnounce}
    />
  );
}

function ScreenConversation({
  screen,
  conversation,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly conversation: ConversationHandle;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onWorkingChange: (working: boolean) => void;
  readonly onAnnounce: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [live, setLive] = useState<AssistantTurnView | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const send = async (): Promise<void> => {
    const message = value.trim();
    if (message === "" || screen === undefined || live !== undefined) return;
    setValue("");
    setFailed(false);
    conversation.append([{ role: "user", content: message }]);
    let turn = EMPTY_TURN;
    setLive(turn);
    onWorkingChange(true);
    onAnnounce(t("agent.announce.working"));
    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;

    try {
      const response = await fetch("/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversation: [...conversation.turns, { role: "user", content: message }],
          screen: screen.screen,
          params: screen.params,
          conversationId: conversation.id,
        }),
      });
      if (!response.ok || response.body === null) {
        setFailed(true);
        onAnnounce(t("agent.announce.failed"));
        return;
      }
      for await (const event of readAssistEvents(response.body)) {
        turn = applyTurnEvent(turn, event);
        setLive(turn);
        const step = runningStep(turn);
        if (step !== undefined) onAnnounce(t(step.label));
      }
      const ended = finishTurn(turn);
      const text = turnText(ended).trim();
      if (text !== "") conversation.append([{ role: "assistant", content: text }]);
      onAnnounce(stoppedRef.current ? t("agent.announce.stopped") : t("agent.announce.done"));
    } catch {
      if (!stoppedRef.current) {
        setFailed(true);
        onAnnounce(t("agent.announce.failed"));
      }
    } finally {
      abortRef.current = null;
      setLive(undefined);
      onWorkingChange(false);
    }
  };

  return (
    <div className="qcms-assistant__conversation">
      <ol className="qcms-assistant__turns" data-testid="qcms-assistant-turns">
        {conversation.turns.map((turn, index) => (
          <li
            key={`${turn.role}-${String(index)}`}
            className="qcms-assistant__turn"
            data-role={turn.role}
          >
            {turn.role === "assistant" && <AssistMark size={20} />}
            <AssistMarkdown text={turn.content} />
          </li>
        ))}
        {live !== undefined && (
          <li className="qcms-assistant__turn" data-role="assistant" aria-busy="true">
            <AssistMark size={20} working />
            <AssistMarkdown text={turnText(live)} />
          </li>
        )}
      </ol>
      {conversation.turns.length === 0 && live === undefined && (
        <p className="qcms-assistant__empty" data-testid="qcms-assistant-empty">
          {t("agent.empty")}
        </p>
      )}
      {failed && (
        <p className="qcms-assistant__error" data-testid="qcms-assistant-error">
          {t("agent.error")}
        </p>
      )}
      <div className="qcms-assistant__composer">
        <label className="qcms-visually-hidden" htmlFor="qcms-assistant-composer">
          {t("agent.composer")}
        </label>
        <textarea
          id="qcms-assistant-composer"
          ref={composerRef}
          rows={3}
          value={value}
          data-testid="qcms-assistant-composer"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void send();
          }}
        />
        {/* The kit's `Button` takes no `data-testid`, so the handle is the wrapper, which
            is the shape `assist-panel.tsx` already uses for its own composer. */}
        {live === undefined ? (
          <span data-testid="qcms-assistant-send">
            <Button
              onPress={() => {
                void send();
              }}
              isDisabled={value.trim() === "" || screen === undefined}
            >
              {t("agent.send")}
            </Button>
          </span>
        ) : (
          <span data-testid="qcms-assistant-stop">
            <Button
              onPress={() => {
                stoppedRef.current = true;
                abortRef.current?.abort();
              }}
            >
              {t("agent.stop")}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
