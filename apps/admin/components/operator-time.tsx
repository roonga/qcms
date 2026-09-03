"use client";

import { useEffect, useState } from "react";

import { formatDateTime, formatOperatorDateTime, isInstant } from "@/lib/i18n/format";

/**
 * Operator-local timestamp display, without a hydration mismatch (issue #279).
 *
 * The Code Owner accepted UTC display on 2026-08-02 and queued local display as the
 * follow-up. What made it a follow-up rather than a one-line change is that every screen
 * showing a timestamp is a client component Next also renders on the server, and a
 * formatter that resolves its zone from the ambient runtime produces one string in Node
 * and another in the browser. React reports that as a hydration mismatch, and the suite's
 * shared console gate fails the run on it.
 *
 * ## Why this is safe, stated exactly
 *
 * React compares the server's HTML against the **first** client render only. So the rule
 * this module enforces is: the first render is `formatDateTime` - the pinned `en` catalog
 * locale, pinned UTC - on both sides of the boundary, byte for byte, because it reads
 * nothing from the runtime it is executing in. `useState(false)` guarantees that: its
 * initial value is the same constant in Node and in the browser, and effects do not run
 * during hydration's first pass. Only afterwards does the effect flip the flag and cause a
 * second, browser-only render on the operator's own clock. That second render is an
 * ordinary state update, which React is free to produce different output for.
 *
 * Only the ZONE comes from the runtime. The locale stays `ADMIN_LOCALE`, so an operator
 * elsewhere reads their own clock inside English prose rather than a German date shape in
 * an English sentence: ADR-27 makes a second locale a configuration change that swaps
 * `ADMIN_LOCALE` alongside the catalog, and R7 defers that to Phase 4. The argument, and
 * the one line that would widen it, live at `formatOperatorDateTime`.
 *
 * The mismatch is therefore impossible by construction rather than avoided by care: there
 * is no code path on which `formatOperatorDateTime` can be reached during a server render,
 * because `hydrated` cannot be `true` there.
 *
 * ## What the markup carries
 *
 * `<time dateTime={iso}>` keeps the machine-readable UTC instant in the DOM whatever the
 * text says, so the wire value stays inspectable and a reader's zone never has to be
 * reverse-engineered out of prose. An unreadable value renders the caller's fallback with
 * no `<time>` around it, because `dateTime` with nothing valid in it would be a worse
 * answer than none.
 *
 * ## Out of scope, deliberately
 *
 * The mint dialog's expiry promise stays UTC and stays explicitly named. It is a promise
 * about when a link stops working for a respondent somewhere else, not a convenience for
 * the operator reading it, so it does not come through here.
 */

/**
 * The date-time formatter this render should use: pinned UTC until hydration finishes,
 * the operator's own zone afterwards (their locale is not taken; see the module note).
 *
 * A hook rather than only a component, because two callers put the result inside a
 * catalog sentence (`t("...", { time })`) rather than in an element of its own, and there
 * is no place to hang a component there. Same formatter, same hydration gate, one path.
 */
export function useOperatorDateTimeFormat(): (
  iso: string | null | undefined,
  fallback?: string,
) => string {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated ? formatOperatorDateTime : formatDateTime;
}

/**
 * One operator-facing timestamp: UTC through hydration, then the operator's own clock.
 *
 * The fallback is the caller's, because "there is no such instant" reads differently per
 * screen ("None", "-", a blank cell) and that is copy, not formatting.
 */
export function OperatorDateTime({
  iso,
  fallback = "",
}: {
  readonly iso: string | null | undefined;
  readonly fallback?: string;
}) {
  const format = useOperatorDateTimeFormat();
  const text = format(iso, fallback);
  if (!isInstant(iso)) return <>{text}</>;
  return <time dateTime={iso}>{text}</time>;
}
