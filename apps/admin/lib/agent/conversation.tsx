"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import {
  CONVERSATION_STORAGE_KEY,
  appendCapped,
  atSubject,
  parseConversation,
  serializeConversation,
  startConversation,
  type AgentTurnRecord,
  type ConversationState,
} from "./conversation-state";
import { conversationSubject, screenForPath } from "./screens";

export {
  CONVERSATION_TURN_CAP,
  isProseTurn,
  promptTurns,
  type AgentProseTurn,
  type AgentTurnRecord,
  type PromptTurn,
} from "./conversation-state";

/**
 * One conversation for the whole app, kept in this tab's session storage.
 *
 * It follows the operator between screens: walking from the question library to a form's
 * builder to Workspaces keeps the dialogue, and each turn gets the facts of the screen it
 * was sent from, rebuilt by the API for that turn. It survives a reload for the same
 * reason it survives navigation - the operator did not end it - and it ends on sign-out or
 * on New conversation in the panel header.
 *
 * The stored entry names the user it belongs to, so a tab whose session storage outlived a
 * sign-out hands nothing to the next person: a mismatch is discarded, and the sign-out
 * control clears the entry as well.
 */

export interface ConversationHandle {
  /** Random, minted when the conversation starts; the key audited reads are grouped by. */
  readonly id: string;
  /** The current stay on {@link subject}: a new one each time the conversation returns. */
  readonly visitId: string;
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  /** How many of the oldest turns the cap has dropped. */
  readonly dropped: number;
  /**
   * The turns as they are NOW, for a caller that appends and posts in one go: {@link turns}
   * is the snapshot this handle was built from, and a render has not happened in between.
   */
  readonly current: () => readonly AgentTurnRecord[];
  readonly append: (turns: readonly AgentTurnRecord[]) => void;
  /** New conversation: a fresh id and an empty history. */
  readonly restart: () => void;
}

const INERT: ConversationHandle = {
  id: "none",
  visitId: "none",
  subject: "none",
  turns: [],
  dropped: 0,
  current: () => [],
  append: () => undefined,
  restart: () => undefined,
};

const ConversationContext = createContext<ConversationHandle>(INERT);

function mint(): string {
  return `cnv_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Tab storage can be unavailable or full; a conversation is not worth failing a render for. */
function readStored(user: string): ConversationState | undefined {
  try {
    return parseConversation(window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY), user);
  } catch {
    return undefined;
  }
}

function writeStored(state: ConversationState, user: string): void {
  try {
    window.sessionStorage.setItem(CONVERSATION_STORAGE_KEY, serializeConversation(state, user));
  } catch {
    // Nothing to do: the conversation stays in memory for this page's life.
  }
}

/** Drop this tab's conversation, which is what signing out does to it. */
export function clearStoredConversation(): void {
  try {
    window.sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

export function ConversationProvider({
  pathname,
  userId,
  children,
}: {
  readonly pathname: string;
  /** Who the stored conversation belongs to; an entry naming anyone else is discarded. */
  readonly userId: string;
  readonly children: ReactNode;
}) {
  const subject = conversationSubject(screenForPath(pathname));
  const held = useRef<ConversationState | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  const handle = useMemo<ConversationHandle>(() => {
    // The first render on the server has no tab storage, so the conversation starts in
    // memory and the stored one is read on the first render that has a window.
    const restored =
      held.current ??
      (typeof window === "undefined" ? undefined : readStored(userId)) ??
      startConversation(subject, mint);
    const state = atSubject(restored, subject, mint);
    held.current = state;
    if (typeof window !== "undefined" && state !== restored) writeStored(state, userId);

    const replace = (next: ConversationState): void => {
      held.current = next;
      if (typeof window !== "undefined") writeStored(next, userId);
      setRevision((count) => count + 1);
    };

    return {
      id: state.id,
      visitId: state.visitId,
      subject: state.subject,
      turns: state.turns,
      dropped: state.dropped,
      current: () => held.current?.turns ?? state.turns,
      // Read back from the holder rather than from this handle: a panel that appends twice
      // in one turn holds the handle it started with, and appending onto that handle's own
      // snapshot would drop whichever turn was recorded first.
      append: (turns) => {
        replace(appendCapped(held.current ?? state, turns));
      },
      restart: () => {
        replace(startConversation(subject, mint));
      },
    };
    // `revision` is what republishes the handle after an append.
  }, [subject, userId, revision]);

  return <ConversationContext.Provider value={handle}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationHandle {
  return useContext(ConversationContext);
}
