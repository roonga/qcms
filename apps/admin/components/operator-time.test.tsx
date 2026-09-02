import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatorDateTime, useOperatorDateTimeFormat } from "./operator-time.tsx";
import { formatDateTime, formatOperatorDateTime } from "../lib/i18n/format.ts";

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

const INSTANT = "2026-08-02T04:36:17.098Z";

/** Render `node` with the process on `zone`, then put the zone back. */
function markupInZone(zone: string, node: React.ReactNode): string {
  const original = process.env.TZ;
  try {
    process.env.TZ = zone;
    return renderToStaticMarkup(node);
  } finally {
    process.env.TZ = original;
  }
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
    const markup = markupInZone("Australia/Sydney", <OperatorDateTime iso={INSTANT} />);

    expect(markup).toContain(formatDateTime(INSTANT));
    // Stated in both directions: the local string for that zone is genuinely different,
    // so "contains the UTC one" is not passing by coincidence.
    const local = markupInZone("Australia/Sydney", <>{formatOperatorDateTime(INSTANT)}</>);
    expect(markup).not.toContain(local);
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
    expect(markupInZone("Australia/Sydney", <OperatorDateTime iso={INSTANT} />)).toMatch(
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

    expect(markupInZone("Australia/Sydney", <Probe />)).toBe("true");
  });
});
