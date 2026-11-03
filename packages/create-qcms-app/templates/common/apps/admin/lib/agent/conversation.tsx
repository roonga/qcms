"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import type { ActionResultTurn } from "./plan-state";
import { conversationSubject, screenForPath } from "./screens";

/** Keep conversations only in shell memory. Sign-out does not clear tab storage, so persistence could expose one operator conversation to the next user. */

export interface AgentProseTurn {
  /** `result` is the builder panel's own record of a card's outcome, never a model turn. */
  readonly role: "user" | "assistant" | "result";
  readonly content: string;
}

/** Action-result turns are built from the card fold and registered result allowlists, never model prose, content or secrets. */
export type AgentTurnRecord = AgentProseTurn | ActionResultTurn;

export function isProseTurn(turn: AgentTurnRecord): turn is AgentProseTurn {
  return turn.role !== "action-result";
}

export type PromptTurn =
  { readonly role: "user" | "assistant"; readonly content: string } | ActionResultTurn;

export function promptTurns(turns: readonly AgentTurnRecord[]): readonly PromptTurn[] {
  return turns.flatMap((turn): readonly PromptTurn[] => {
    if (!isProseTurn(turn)) return [turn];
    return turn.role === "result" ? [] : [{ role: turn.role, content: turn.content }];
  });
}

export interface ConversationHandle {
  readonly id: string;
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  /** Read live turns when appending and posting before React renders again; the handle snapshot may already be stale. */
  readonly current: () => readonly AgentTurnRecord[];
  readonly append: (turns: readonly AgentTurnRecord[]) => void;

  readonly restart: () => void;
}

const INERT: ConversationHandle = {
  id: "none",
  subject: "none",
  turns: [],
  current: () => [],
  append: () => undefined,
  restart: () => undefined,
};

const ConversationContext = createContext<ConversationHandle>(INERT);

function mint(): string {
  return `cnv_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function ConversationProvider({
  pathname,
  children,
}: {
  readonly pathname: string;
  readonly children: ReactNode;
}) {
  const held = useRef(new Map<string, { id: string; turns: readonly AgentTurnRecord[] }>());
  const [revision, setRevision] = useState(0);
  const subject = conversationSubject(screenForPath(pathname));

  const handle = useMemo<ConversationHandle>(() => {
    const existing = held.current.get(subject) ?? { id: mint(), turns: [] };
    held.current.set(subject, existing);
    const replace = (next: { id: string; turns: readonly AgentTurnRecord[] }): void => {
      held.current.set(subject, next);
      setRevision((count) => count + 1);
    };
    return {
      subject,
      id: existing.id,
      turns: existing.turns,
      current: () => held.current.get(subject)?.turns ?? existing.turns,
      /** Append against the current map entry so two appends from one render cannot overwrite each other. */
      append: (turns) => {
        const current = held.current.get(subject) ?? existing;
        replace({ id: current.id, turns: [...current.turns, ...turns] });
      },
      restart: () => {
        replace({ id: mint(), turns: [] });
      },
    };
  }, [subject, revision]);

  return <ConversationContext.Provider value={handle}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationHandle {
  return useContext(ConversationContext);
}
