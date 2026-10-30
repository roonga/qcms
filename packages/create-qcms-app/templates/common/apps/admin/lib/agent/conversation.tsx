"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { conversationSubject, screenForPath } from "./screens";

/**
 * One conversation per subject, held in memory for as long as the tab's shell lives.
 *
 * A form's whole subtree is one subject, so walking from the builder to Releases keeps the
 * conversation and the next turn is prefaced with the new screen. Leaving the form starts a
 * new conversation keyed by the new subject, and returning within the tab restores the old
 * one. Nothing is written to `localStorage` or `sessionStorage`: sign-out is a form post
 * that does not clear tab storage, so a shared workstation would otherwise show the next
 * user the last user's conversation (Q15).
 */

export interface AgentTurnRecord {
  /** `result` is the builder panel's own record of a card's outcome, never a model turn. */
  readonly role: "user" | "assistant" | "result";
  readonly content: string;
}

/** The history a turn replays: the prose, without the panel's own outcome lines. */
export function promptTurns(
  turns: readonly AgentTurnRecord[],
): readonly { readonly role: "user" | "assistant"; readonly content: string }[] {
  return turns.flatMap((turn) =>
    turn.role === "result" ? [] : [{ role: turn.role, content: turn.content }],
  );
}

export interface ConversationHandle {
  /** Random, minted when the conversation starts; the key audited reads are grouped by. */
  readonly id: string;
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  readonly append: (turns: readonly AgentTurnRecord[]) => void;
  /** New conversation: a fresh id and an empty history for this subject. */
  readonly restart: () => void;
}

const INERT: ConversationHandle = {
  id: "none",
  subject: "none",
  turns: [],
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
      append: (turns) => {
        replace({ id: existing.id, turns: [...existing.turns, ...turns] });
      },
      restart: () => {
        replace({ id: mint(), turns: [] });
      },
    };
    // `revision` is what republishes the handle after an append.
  }, [subject, revision]);

  return <ConversationContext.Provider value={handle}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationHandle {
  return useContext(ConversationContext);
}
