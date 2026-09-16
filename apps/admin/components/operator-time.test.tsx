import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OperatorDateTime,
  OperatorDay,
  useOperatorDateTimeFormat,
  useOperatorDayFormat,
} from "./operator-time.tsx";
import {
  ADMIN_LOCALE,
  formatDateTime,
  formatDay,
  formatOperatorDateTime,
  formatOperatorDay,
} from "../lib/i18n/format.ts";

/**
 * The hydration gate (issue #279).
 *
 * The property that matters is not "the timestamp is local" - `lib/i18n/format.test.ts`
 * pins that. It is that the string React compares across the server/client boundary does
 * not depend on the runtime that produced it, because a mismatch there is a red run
 * through the suite's shared console gate rather than a cosmetic wobble.
 *
 * `renderToStaticMarkup` is exactly the right layer for that (ADR-23, and the same
 * argument `question-versions-rail.test.tsx` makes): it renders the component the way the
 * server does, effects and all excluded, which is also the way the first client render
 * behaves. React's contract is that effects do not run during hydration's first pass, so
 * "what this test renders" and "what the browser renders before the swap" are the same
 * thing. The swap itself is one `useState` update afterwards and needs no assertion of its
 * own: `useOperatorDateTimeFormat` has exactly two branches and both are pinned here.
 *
 * What this deliberately does not do is add jsdom to run a real hydration. The mismatch
 * this guards against is a *difference between two renders*, and the difference can only
 * come from the ambient zone, so varying the zone across a static render answers it
 * without a DOM.
 */

/**
 * The instant every case here renders, chosen so no assertion can pass vacuously
 * (issue #903).
 *
 * **23:30 UTC on 2 August**, which is already 3 August in Sydney and still 2 August in Los
 * Angeles. Both halves of this file compare a pinned-UTC render against the string an
 * operator elsewhere reads, and with a mid-afternoon instant those two strings differ only
 * in their clock. At this instant they differ in their calendar DAY as well, so the
 * pinned-versus-operator assertions bite on the day column too, where there is no clock in
 * the output to differ in at all.
 *
 * Australia/Sydney is UTC+10 or +11 and Los Angeles UTC-7 or -8, so the instant sits on a
 * different local day in each of them in either half of the year: this cannot start passing
 * or failing on a daylight-saving boundary. `lib/i18n/format.test.ts` picks the same instant
 * for the same reason.
 */
const INSTANT = "2026-08-02T23:30:00.000Z";

/** The zone the pinned-versus-operator cases read as "somewhere that is not UTC". */
const OPERATOR_ZONE = "Australia/Sydney";

/**
 * Render `node` with the process on `zone`, then put the zone back.
 *
 * An unset `TZ` is restored by DELETING the variable, not by assigning back the `undefined`
 * it was read as: `process.env.TZ = undefined` stores the literal string `"undefined"`,
 * which ICU does not recognize, so every later case in the file runs on a zone that formats
 * as `GMT+0` instead of on the machine's own.
 *
 * That leak is why issue #903 was invisible on a runner with no `TZ` set, which is how CI
 * runs: the ambient-zone expectation this file used to build was computed after the first
 * case had already sprung the leak, so it carried a `GMT+0` spelling the pinned-UTC markup
 * could never contain, and the assertion passed without testing anything.
 */
function markupInZone(zone: string, node: ReactNode): string {
  const original = process.env.TZ;
  try {
    process.env.TZ = zone;
    return renderToStaticMarkup(node);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

/**
 * What an operator in `zone` reads for `iso`, with the zone **named** rather than ambient
 * (issue #903).
 *
 * The failure mode these two helpers exist to remove: an expectation that calls an operator
 * formatter in an argument list resolves its zone where this file is executing, not where
 * the render is, because `markupInZone` is only in effect during the render it wraps. The
 * assertion then compares the markup against the RUNNER's zone, and it is green three
 * different ways for three different wrong reasons - vacuously when the runner sits in some
 * third zone, by coincidence when the runner happens to sit in the zone under test, and red
 * when the runner is on UTC, where the "operator" string it builds is the pinned string
 * itself. Naming `timeZone` makes the expectation a fact about the zone under test that no
 * runner can move.
 *
 * The option bags restate `lib/i18n/format.ts` rather than borrowing its formatters,
 * deliberately: an expectation computed by the code under test cannot disagree with it. The
 * restatement is checked against the real formatter in the cases below, and the shapes
 * themselves are pinned in `lib/i18n/format.test.ts`.
 */
function operatorDateTimeIn(zone: string, iso: string): string {
  return new Intl.DateTimeFormat(ADMIN_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** The day half of {@link operatorDateTimeIn}: no clock, no zone name, zone still named. */
function operatorDayIn(zone: string, iso: string): string {
  return new Intl.DateTimeFormat(ADMIN_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date(iso));
}

describe("the server render, and the first client render with it", () => {
  it("is byte-identical whatever zone the runtime is in", () => {
    // The one assertion the whole design exists for. Two runtimes as far apart as the
    // zone database allows: if the server-side branch ever reached the operator formatter,
    // these two strings would differ and Next would report a hydration mismatch.
    const east = markupInZone("Pacific/Kiritimati", <OperatorDateTime iso={INSTANT} />);
    const west = markupInZone("Pacific/Midway", <OperatorDateTime iso={INSTANT} />);

    expect(east).toBe(west);
  });

  it("is the pinned UTC string, not the operator's", () => {
    const markup = markupInZone(OPERATOR_ZONE, <OperatorDateTime iso={INSTANT} />);

    expect(markup).toContain(formatDateTime(INSTANT));
    // Stated in both directions: the string an operator in that zone reads is genuinely
    // different, so "contains the UTC one" is not passing because the two agree.
    //
    // The expectation names its zone (issue #903). Computing it from the ambient zone is
    // the failure mode: it says nothing about Sydney and everything about the runner.
    const local = operatorDateTimeIn(OPERATOR_ZONE, INSTANT);
    expect(local).not.toBe(formatDateTime(INSTANT));
    // Hand-written too, so a zone-handling defect cannot quietly make the pair agree: 23:30
    // UTC on the 2nd is half past nine on the MORNING OF THE 3rd in Sydney. Matched rather
    // than compared because the separator before AM and the offset label are ICU's to
    // choose: `\s` covers the narrow no-break space newer CLDR data emits there, and
    // `+1[01]` covers Sydney on either side of its daylight-saving boundary.
    expect(local).toMatch(/^Aug 3, 2026, 09:30\sAM GMT\+1[01]$/u);
    expect(formatDateTime(INSTANT)).toMatch(/^Aug 2, 2026, 11:30\sPM UTC$/u);
    expect(markup).not.toContain(local);

    // The one place the restatement in `operatorDateTimeIn` is checked against the module it
    // restates. The formatter runs INSIDE the zone here, in a component that formats during
    // its own render, which is the only way `markupInZone` can reach one at all: if moving
    // `TZ` ever stopped reaching `Intl`, this line fails rather than silently weakening the
    // assertions above.
    function LocalDateTime() {
      return <>{formatOperatorDateTime(INSTANT)}</>;
    }
    expect(markupInZone(OPERATOR_ZONE, <LocalDateTime />)).toBe(local);
  });

  it("keeps the machine-readable instant in the markup whatever the text says", () => {
    // `<time dateTime>` is what makes the wire value inspectable after the swap: the text
    // moves to the reader's clock, the attribute does not move at all.
    //
    // Matched case-insensitively on the attribute NAME because React 19 emits the JSX
    // spelling (`dateTime=`) into the markup rather than lowercasing it. HTML attribute
    // names are case-insensitive, so the parser lands it on `datetime` either way and this
    // is a serialization detail, not a contract - pinning the exact casing would make this
    // a test of React's serializer.
    expect(markupInZone(OPERATOR_ZONE, <OperatorDateTime iso={INSTANT} />)).toMatch(
      new RegExp(`<time datetime="${INSTANT}">`, "iu"),
    );
  });
});

describe("a value that is not an instant", () => {
  it("renders the caller's fallback with no <time> around it", () => {
    // An empty or unparseable `dateTime` would be a worse answer than none: it claims a
    // machine-readable instant and does not carry one.
    const markup = renderToStaticMarkup(<OperatorDateTime iso={null} fallback="None" />);

    expect(markup).toBe("None");
    expect(markup).not.toContain("<time");
  });

  it("renders an empty cell by default, rather than Invalid Date", () => {
    expect(renderToStaticMarkup(<OperatorDateTime iso="not a timestamp" />)).toBe("");
  });
});

describe("the hook the catalog-sentence callers use", () => {
  it("hands back the pinned UTC formatter before hydration finishes", () => {
    // The two callers that put an instant inside a `t(...)` sentence take their formatter
    // from here, so they have to be on the same gate as the element does. Rendering the
    // hook statically is the pre-hydration branch by construction.
    function Probe() {
      const format = useOperatorDateTimeFormat();
      return <>{String(format === formatDateTime)}</>;
    }

    expect(markupInZone(OPERATOR_ZONE, <Probe />)).toBe("true");
  });
});

/**
 * The day-only half, on the same gate (Code Owner, 2026-09-11, issue #582).
 *
 * A day column joined this module rather than getting a mechanism of its own, so the
 * property to pin is the same one: what crosses the server/client boundary cannot depend on
 * the runtime that produced it. The zone pair below is chosen so a mistake would actually
 * show - {@link INSTANT} is 23:30 UTC, which is a different calendar day in the two zones.
 */
describe("the day column's server render", () => {
  it("is byte-identical whatever zone the runtime is in", () => {
    const east = markupInZone(OPERATOR_ZONE, <OperatorDay iso={INSTANT} />);
    const west = markupInZone("America/Los_Angeles", <OperatorDay iso={INSTANT} />);

    expect(east).toBe(west);
  });

  it("is the pinned UTC day, not the operator's", () => {
    const markup = markupInZone(OPERATOR_ZONE, <OperatorDay iso={INSTANT} />);

    expect(markup).toContain(formatDay(INSTANT));
    // And the Sydney day is genuinely a different string, so the line above is not passing
    // because the two agree. This is the case the old UTC-only rule got wrong.
    //
    // The expectation names its zone (issue #903). An operator string resolved from the
    // ambient zone would say nothing about Sydney and everything about the test runner.
    const local = operatorDayIn(OPERATOR_ZONE, INSTANT);
    expect(local).not.toBe(formatDay(INSTANT));
    // Hand-written for the same reason its sibling case states one: 23:30 UTC on the 2nd is
    // already the 3rd in Sydney, and the UTC answer here is the western one, which is what
    // makes the eastern reader the one the old rule was wrong about.
    expect(local).toBe("Aug 3, 2026");
    expect(formatDay(INSTANT)).toBe("Aug 2, 2026");
    expect(markup).not.toContain(local);
    // West of UTC the two agree at this instant - Los Angeles is still on the 2nd - so the
    // assertion above is made for the eastern zone deliberately: that is the reader the
    // pinned string is wrong for, and an assertion has to be made where it can fail.
    expect(operatorDayIn("America/Los_Angeles", INSTANT)).toBe(formatDay(INSTANT));

    // And the restatement in `operatorDayIn` against the module it restates, produced INSIDE
    // the zone by a component that formats during its own render.
    function LocalDay() {
      return <>{formatOperatorDay(INSTANT)}</>;
    }
    expect(markupInZone(OPERATOR_ZONE, <LocalDay />)).toBe(local);
  });

  it("carries the instant in the markup, so the day is checkable after the swap", () => {
    expect(markupInZone(OPERATOR_ZONE, <OperatorDay iso={INSTANT} />)).toMatch(
      new RegExp(`<time datetime="${INSTANT}">`, "iu"),
    );
  });

  it("renders the caller's fallback with no <time> around it", () => {
    expect(renderToStaticMarkup(<OperatorDay iso={null} fallback="None" />)).toBe("None");
    expect(renderToStaticMarkup(<OperatorDay iso="not a day" />)).toBe("");
  });

  it("hands the sentence callers the pinned formatter before hydration finishes", () => {
    // The forms list's Version cell puts its day inside a `t(...)` sentence and takes the
    // formatter from here, so it is on this gate rather than beside it.
    function Probe() {
      const format = useOperatorDayFormat();
      return <>{String(format === formatDay)}</>;
    }

    expect(markupInZone(OPERATOR_ZONE, <Probe />)).toBe("true");
  });
});
