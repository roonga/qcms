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
  conversationKeysToClear,
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
  postedTurns,
  waitingProposalTurns,
  type AgentProseTurn,
  type AgentTurnRecord,
  type EditResultTurn,
  type PromptTurn,
  type WaitingProposalTurn,
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
  /** Copy this conversation to another tab-storage entry, so creating the form it is about does not end it. */
  readonly carryTo: (storageKey: string) => void;
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
  carryTo: () => undefined,
};

const ConversationContext = createContext<ConversationHandle>(INERT);

function mint(): string {
  return `cnv_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Tab storage can be unavailable or full, and a conversation is not worth a failed render. */
function readStored(key: string, user: string): ConversationState | undefined {
  try {
    return parseConversation(window.sessionStorage.getItem(key), user);
  } catch {
    return undefined;
  }
}

function writeStored(key: string, state: ConversationState, user: string): void {
  try {
    window.sessionStorage.setItem(key, serializeConversation(state, user));
  } catch {
    return;
  }
}

/** Drop this tab's conversations, the dock's and the builder's, which is what signing out does to them. */
export function clearStoredConversation(): void {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of conversationKeysToClear(keys)) storage.removeItem(key);
  } catch {
    return;
  }
}

export function ConversationProvider({
  pathname,
  userId,
  storageKey = CONVERSATION_STORAGE_KEY,
  children,
}: {
  readonly pathname: string;
  /** Who the stored conversation belongs to; an entry naming anyone else is discarded. */
  readonly userId: string;
  /** The tab storage entry; the builder passes its own so it never reads or writes the dock's. */
  readonly storageKey?: string;
  readonly children: ReactNode;
}) {
  const subject = conversationSubject(screenForPath(pathname));
  // Held with its owner, so a shell that re-renders under a different user drops it rather
  // than handing it on.
  const held = useRef<{ readonly owner: string; readonly state: ConversationState } | undefined>(
    undefined,
  );
  const [revision, setRevision] = useState(0);
  /** The entry and user whose stored conversation has been read back, so it is read once. */
  const loadedFor = useRef<string | undefined>(undefined);
  const owner = JSON.stringify([storageKey, userId]);

  // The stored conversation is read after hydration rather than during the first render:
  // the server has no tab storage, and a client that rendered the restored turns straight
  // away would not match the HTML it is hydrating.
  useEffect(() => {
    if (loadedFor.current === owner) return;
    loadedFor.current = owner;
    const stored = readStored(storageKey, userId);
    if (stored === undefined) return;
    held.current = { owner, state: stored };
    setRevision((count) => count + 1);
  }, [owner, storageKey, userId]);

  const handle = useMemo<ConversationHandle>(() => {
    const mine = held.current?.owner === owner ? held.current.state : undefined;
    const state = atSubject(mine ?? startConversation(subject, mint), subject, mint);
    held.current = { owner, state };

    const replace = (next: ConversationState): void => {
      held.current = { owner, state: next };
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
      carryTo: (key) => {
        if (key === storageKey) return;
        writeStored(key, held.current?.state ?? state, userId);
      },
    };
  }, [subject, owner, revision, storageKey, userId]);

  // Persisted after the read above, never during a render, so a fresh first render cannot
  // overwrite the entry it is about to restore.
  useEffect(() => {
    if (loadedFor.current !== owner) return;
    const current = held.current;
    if (current?.owner === owner) writeStored(storageKey, current.state, userId);
  }, [handle, owner, storageKey, userId]);

  return <ConversationContext.Provider value={handle}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationHandle {
  return useContext(ConversationContext);
}
