"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Share markers and hand-offs across the shell, but never execute from them. A hand-off opens the ordinary screen control where the user types the secret. */

export interface WaitingProposal {
  readonly cardId: string;

  readonly summary: string;

  readonly control?: string;
}

export interface HandOffRequest {
  readonly control: string;

  readonly fields: Readonly<Record<string, string>>;

  readonly nonce: number;
}

export interface ProposalSeam {
  readonly waiting: WaitingProposal | undefined;

  readonly publish: (waiting: WaitingProposal | undefined) => void;

  readonly review: () => void;
  readonly handOff: HandOffRequest | undefined;
  readonly requestHandOff: (control: string, fields: Readonly<Record<string, string>>) => void;
  readonly clearHandOff: () => void;
}

const SeamContext = createContext<ProposalSeam | undefined>(undefined);

export function useProposalSeam(): ProposalSeam | undefined {
  return useContext(SeamContext);
}

function same(was: WaitingProposal | undefined, next: WaitingProposal | undefined): boolean {
  if (was === undefined || next === undefined) return was === next;
  return was.cardId === next.cardId && was.summary === next.summary && was.control === next.control;
}

export function ProposalSeamProvider({
  onReview,
  children,
}: {
  readonly onReview: () => void;
  readonly children: ReactNode;
}) {
  const [waiting, setWaiting] = useState<WaitingProposal | undefined>(undefined);
  const [handOff, setHandOff] = useState<HandOffRequest | undefined>(undefined);

  const publish = useCallback((next: WaitingProposal | undefined) => {
    setWaiting((was) => (same(was, next) ? was : next));
  }, []);

  const requestHandOff = useCallback(
    (control: string, fields: Readonly<Record<string, string>>) => {
      setHandOff((was) => ({ control, fields, nonce: (was?.nonce ?? 0) + 1 }));
    },
    [],
  );

  const clearHandOff = useCallback(() => {
    setHandOff(undefined);
  }, []);

  const review = useCallback(() => {
    onReview();
    const cardId = waiting?.cardId;
    if (cardId === undefined) return;
    /** Focus after the panel mounts; a heading in an unmounted panel cannot receive focus. */
    window.setTimeout(() => document.getElementById(`${cardId}-title`)?.focus(), 0);
  }, [onReview, waiting?.cardId]);

  const seam = useMemo<ProposalSeam>(
    () => ({ waiting, publish, review, handOff, requestHandOff, clearHandOff }),
    [clearHandOff, handOff, publish, requestHandOff, review, waiting],
  );

  return <SeamContext.Provider value={seam}>{children}</SeamContext.Provider>;
}

export interface MarkerBinding {
  readonly cardId: string;
  readonly summary: string;
  readonly onReview: () => void;
}

export function useProposalMarker(controls: readonly string[]): MarkerBinding | undefined {
  const seam = useProposalSeam();
  const waiting = seam?.waiting;
  const control = waiting?.control;
  if (seam === undefined || waiting === undefined || control === undefined) return undefined;
  if (!controls.includes(control)) return undefined;
  return { cardId: waiting.cardId, summary: waiting.summary, onReview: seam.review };
}

export interface HandOffBinding {
  readonly fields: Readonly<Record<string, string>>;
  readonly nonce: number;
  readonly done: () => void;
}

export function useHandOff(control: string): HandOffBinding | undefined {
  const seam = useProposalSeam();
  const handOff = seam?.handOff;
  if (seam === undefined || handOff === undefined || handOff.control !== control) return undefined;
  return { fields: handOff.fields, nonce: handOff.nonce, done: seam.clearHandOff };
}
