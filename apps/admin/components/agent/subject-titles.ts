"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { readSubjectTitlesAction } from "@/app/(shell)/assist/titles";
import { subjectIds } from "@/lib/agent/card-copy";
import type { AgentProposal } from "@/lib/forms/assist-stream";

const NONE: ReadonlyMap<string, string> = new Map();

/** Titles for the ids a card names, taken from the lists the operator can already open. */
export function useSubjectTitles(
  proposal: AgentProposal | undefined,
  known: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> | undefined {
  const [found, setFound] = useState<ReadonlyMap<string, string>>(NONE);
  const asked = useRef(new Set<string>());

  const wanted = useMemo(
    () =>
      (proposal === undefined ? [] : subjectIds(proposal.steps))
        .filter((id) => known?.has(id) !== true)
        .sort()
        .join(" "),
    [proposal, known],
  );

  useEffect(() => {
    const ids = wanted.split(" ").filter((id) => id !== "" && !asked.current.has(id));
    if (ids.length === 0) return undefined;
    for (const id of ids) asked.current.add(id);
    let live = true;
    void readSubjectTitlesAction(ids).then(
      (titles) => {
        if (!live || Object.keys(titles).length === 0) return;
        setFound((before) => new Map([...before, ...Object.entries(titles)]));
      },
      () => {
        // A failed read leaves the card on its own fallback rather than blocking it.
      },
    );
    return () => {
      live = false;
    };
  }, [wanted]);

  return useMemo(() => {
    if (known === undefined) return found.size === 0 ? undefined : found;
    return new Map([...found, ...known]);
  }, [known, found]);
}
