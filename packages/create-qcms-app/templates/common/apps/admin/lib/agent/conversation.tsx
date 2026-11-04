"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
 * The stored entry names the user it belongs to and a mismatch is discarded: sign-out does
 * not clear tab storage on its own, and the next operator must not inherit a conversation.
 */

export interface ConversationHandle {
  readonly id: string;
  /** The current stay on {@link subject}: a new one each time the conversation returns. */
  readonly visitId: string;
  readonly subject: string;
  readonly turns: readonly AgentTurnRecord[];
  /** How many of the oldest turns the cap has dropped. */
  readonly dropped: number;
  /** Read live turns when appending and posting before React renders again; the handle snapshot may already be stale. */
  readonly current: () => readonly AgentTurnRecord[];
  readonly append: (turns: readonly AgentTurnRecord[]) => void;
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

/** Tab storage can be unavailable or full, and a conversation is not worth a failed render. */
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
    return;
  }
}

/** Drop this tab's conversation, which is what signing out does to it. */
export function clearStoredConversation(): void {
  try {
    window.sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    return;
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
  // Held with its owner, so a shell that re-renders under a different user drops it rather
  // than handing it on.
  const held = useRef<{ readonly user: string; readonly state: ConversationState } | undefined>(
    undefined,
  );
  const [revision, setRevision] = useState(0);
  /** The user whose stored conversation has been read back, so it is read once. */
  const loadedFor = useRef<string | undefined>(undefined);

  // The stored conversation is read after hydration rather than during the first render:
  // the server has no tab storage, and a client that rendered the restored turns straight
  // away would not match the HTML it is hydrating.
  useEffect(() => {
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    const stored = readStored(userId);
    if (stored === undefined) return;
    held.current = { user: userId, state: stored };
    setRevision((count) => count + 1);
  }, [userId]);

  const handle = useMemo<ConversationHandle>(() => {
    const mine = held.current?.user === userId ? held.current.state : undefined;
    const state = atSubject(mine ?? startConversation(subject, mint), subject, mint);
    held.current = { user: userId, state };

    const replace = (next: ConversationState): void => {
      held.current = { user: userId, state: next };
      setRevision((count) => count + 1);
    };

    return {
      id: state.id,
      visitId: state.visitId,
      subject: state.subject,
      turns: state.turns,
      dropped: state.dropped,
      current: () => held.current?.state.turns ?? state.turns,
      /** Append against the held state so two appends from one render cannot overwrite each other. */
      append: (turns) => {
        replace(appendCapped(held.current?.state ?? state, turns));
      },
      restart: () => {
        replace(startConversation(subject, mint));
      },
    };
  }, [subject, userId, revision]);

  // Persisted after the read above, never during a render, so a fresh first render cannot
  // overwrite the entry it is about to restore.
  useEffect(() => {
    if (loadedFor.current !== userId) return;
    const current = held.current;
    if (current?.user === userId) writeStored(current.state, userId);
  }, [handle, userId]);

  return <ConversationContext.Provider value={handle}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationHandle {
  return useContext(ConversationContext);
}
