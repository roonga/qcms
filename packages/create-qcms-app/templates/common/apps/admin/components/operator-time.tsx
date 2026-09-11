"use client";

import { useEffect, useState } from "react";

import {
  formatDateTime,
  formatDay,
  formatOperatorDateTime,
  formatOperatorDay,
  isInstant,
} from "@/lib/i18n/format";

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
 * ## Day-only columns come through here too (issue #582)
 *
 * They did not, until the Code Owner's ruling of 2026-09-11: a bare calendar-day column
 * stayed UTC on the ground that it has no clock in its output to name a zone on. The value
 * is still an instant, so the UTC day could name a day the operator's own clock never
 * agreed with, and one zone across every table is what the #794 ruling settled.
 * {@link OperatorDay} and {@link useOperatorDayFormat} are that half, and they are the same
 * mechanism rather than a parallel one: pinned UTC through hydration, the operator's zone
 * after. What a day column does NOT gain is a clock or a zone name; it is still a day.
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

/**
 * The day formatter this render should use: pinned UTC until hydration finishes, the
 * operator's own zone afterwards.
 *
 * A hook as well as a component for the same reason its sibling is one: the forms list puts
 * its day inside a catalog sentence ("v3, frozen {date}") rather than in an element of its
 * own, and there is no place to hang a component there.
 */
export function useOperatorDayFormat(): (
  iso: string | null | undefined,
  fallback?: string,
) => string {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated ? formatOperatorDay : formatDay;
}

/**
 * One operator-facing calendar day: UTC through hydration, then the operator's own clock.
 *
 * The `<time dateTime>` wrapper is the same bargain the timestamp makes: whatever the text
 * says, the machine-readable instant stays in the DOM, so a reader never has to
 * reverse-engineer a zone out of prose. The attribute carries the full instant rather than
 * a `YYYY-MM-DD` slice, because the instant is what the row actually holds and slicing it
 * would re-state the UTC day this component exists to stop being the only answer.
 */
export function OperatorDay({
  iso,
  fallback = "",
}: {
  readonly iso: string | null | undefined;
  readonly fallback?: string;
}) {
  const format = useOperatorDayFormat();
  const text = format(iso, fallback);
  if (!isInstant(iso)) return <>{text}</>;
  return <time dateTime={iso}>{text}</time>;
}
