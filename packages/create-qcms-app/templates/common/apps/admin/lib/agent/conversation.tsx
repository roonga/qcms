"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import type { ActionResultTurn } from "./plan-state";
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

export interface AgentProseTurn {
  /** `result` is the builder panel's own record of a card's outcome, never a model turn. */
  readonly role: "user" | "assistant" | "result";
  readonly content: string;
}

/**
 * One confirmed card's report (083 D0, section 5.3). The admin writes it from the card's
 * own fold and each kind's result allowlist, so it carries no model text, no content and
 * no secret, and the API renders it to the model from these fields rather than from prose.
 */
export type AgentTurnRecord = AgentProseTurn | ActionResultTurn;

export function isProseTurn(turn: AgentTurnRecord): turn is AgentProseTurn {
  return turn.role !== "action-result";
}

/**
 * The history a turn replays: the prose without the panel's own outcome lines, and every
 * `action-result` turn as the structured record it is.
 */
export type PromptTurn =
  { readonly role: "user" | "assistant"; readonly content: string } | ActionResultTurn;

export function promptTurns(turns: readonly AgentTurnRecord[]): readonly PromptTurn[] {
  return turns.flatMap((turn): readonly PromptTurn[] => {
    if (!isProseTurn(turn)) return [turn];
    return turn.role === "result" ? [] : [{ role: turn.role, content: turn.content }];
  });
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
      // Read back from the map rather than from this handle: a panel that appends twice in
      // one turn holds the handle it started with, and appending onto that handle's own
      // snapshot would drop whichever turn was recorded first.
      append: (turns) => {
        const current = held.current.get(subject) ?? existing;
        replace({ id: current.id, turns: [...current.turns, ...turns] });
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
