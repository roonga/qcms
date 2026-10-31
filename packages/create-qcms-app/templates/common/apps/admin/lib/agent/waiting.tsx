"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The seam between the panel and every screen's heading row.
 *
 * Two things have to cross it. A card waiting on the current screen has to reach the
 * heading-row control its first not-yet-run step mirrors, so that control can carry the
 * proposal marker; and a hand-off step's Confirm has to reach that screen's own control
 * with the non-secret arguments filled, because the secret is typed there and nowhere
 * else. The panel and the heading rows are two places in the shell tree, so the state
 * they share lives above both.
 *
 * Nothing here can run anything: the marker is a link to the card and a hand-off opens a
 * control the user completes themselves.
 */

/** The card waiting on this screen, as the heading rows need to see it. */
export interface WaitingProposal {
  /** The card article's element id. The marker links to it. */
  readonly cardId: string;
  /** The first not-yet-run step's title, which the marker's description names. */
  readonly summary: string;
  /** The heading-row control that step mirrors, or absent when it mirrors none. */
  readonly control?: string;
}

/** A hand-off step's Confirm, which opens one screen control and sends nothing. */
export interface HandOffRequest {
  /** The control to open, as the step's card template names it. */
  readonly control: string;
  /** The step's non-secret arguments, for the control's own fields. */
  readonly fields: Readonly<Record<string, string>>;
  /** Distinct per press, so the same hand-off asked twice opens the control twice. */
  readonly nonce: number;
}

export interface ProposalSeam {
  readonly waiting: WaitingProposal | undefined;
  /** Stable, and idempotent for an unchanged card: a screen effect may call it per render. */
  readonly publish: (waiting: WaitingProposal | undefined) => void;
  /** Opens the panel and moves focus to the waiting card's heading. Sends nothing. */
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
  /** Opens the panel, which the dock owns; focusing the heading is this module's half. */
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
    // After the paint that opens the panel: a heading inside a panel that is not yet
    // mounted takes no focus at all.
    window.setTimeout(() => document.getElementById(`${cardId}-title`)?.focus(), 0);
  }, [onReview, waiting?.cardId]);

  const seam = useMemo<ProposalSeam>(
    () => ({ waiting, publish, review, handOff, requestHandOff, clearHandOff }),
    [clearHandOff, handOff, publish, requestHandOff, review, waiting],
  );

  return <SeamContext.Provider value={seam}>{children}</SeamContext.Provider>;
}

/** The marker's own props for one heading-row control, or nothing when none waits on it. */
export interface MarkerBinding {
  readonly cardId: string;
  readonly summary: string;
  readonly onReview: () => void;
}

/**
 * The marker for one heading row, which may host several kinds' controls: a panel whose
 * acts live on its own rows has one heading and several kinds, and only one card ever
 * waits, so one marker is enough for all of them.
 */
export function useProposalMarker(controls: readonly string[]): MarkerBinding | undefined {
  const seam = useProposalSeam();
  const waiting = seam?.waiting;
  const control = waiting?.control;
  if (seam === undefined || waiting === undefined || control === undefined) return undefined;
  if (!controls.includes(control)) return undefined;
  return { cardId: waiting.cardId, summary: waiting.summary, onReview: seam.review };
}

/** One control's pending hand-off: the filled fields, and the acknowledgement. */
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
