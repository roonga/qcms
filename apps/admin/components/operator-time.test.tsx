import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "./locale-context.tsx";
import { OperatorDateTime, OperatorDay, useOperatorDateTimeFormat } from "./operator-time.tsx";
import { DEFAULT_LOCALE, formatDateTime, formatDay } from "../lib/i18n/format.ts";

const INSTANT = "2026-08-02T23:30:00.000Z";

const originalZone = process.env.TZ;

afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

function serverMarkupIn(zone: string, node: ReactNode): string {
  process.env.TZ = zone;
  return renderToStaticMarkup(node);
}

function clientTextIn(zone: string, node: ReactNode): string {
  process.env.TZ = zone;
  const { container, unmount } = render(<>{node}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("the server render, and hydration's first pass with it", () => {
  it("paints no time, so it is byte-identical whatever zone the host is in", () => {
    const east = serverMarkupIn("Pacific/Kiritimati", <OperatorDateTime iso={INSTANT} />);
    const west = serverMarkupIn("Pacific/Midway", <OperatorDateTime iso={INSTANT} />);
    expect(east).toBe(west);
    expect(east).toBe(`<time dateTime="${INSTANT}"></time>`);
  });

  it("never paints a UTC string for an admin time", () => {
    const markup = serverMarkupIn("UTC", <OperatorDay iso={INSTANT} />);
    expect(markup).not.toMatch(/UTC|Aug/u);
  });

  it("renders the caller's fallback for an unreadable instant on both sides", () => {
    expect(renderToStaticMarkup(<OperatorDateTime iso={null} fallback="None" />)).toBe("None");
    expect(renderToStaticMarkup(<OperatorDateTime iso="not a timestamp" />)).toBe("");
    expect(clientTextIn("Australia/Sydney", <OperatorDateTime iso={null} fallback="None" />)).toBe(
      "None",
    );
  });
});

describe("the client render", () => {
  it("names the operator's own day and clock, with the zone, in the default locale", () => {
    const sydney = clientTextIn("Australia/Sydney", <OperatorDateTime iso={INSTANT} />);
    expect(sydney).toBe(
      formatDateTime(INSTANT, { locale: DEFAULT_LOCALE, timeZone: "Australia/Sydney" }),
    );
    expect(sydney.replace(/\u202f/gu, " ")).toMatch(/^3 Aug 2026, 09:30 (AEST|GMT\+10)$/u);
  });

  it("follows the deployment locale, never the browser's", () => {
    const german = clientTextIn(
      "UTC",
      <LocaleProvider locale="de-DE">
        <OperatorDateTime iso={INSTANT} />
      </LocaleProvider>,
    );
    expect(german).toBe("2. Aug. 2026, 23:30 UTC");
    const american = clientTextIn(
      "UTC",
      <LocaleProvider locale="en-US">
        <OperatorDateTime iso={INSTANT} />
      </LocaleProvider>,
    );
    expect(american.replace(/\u202f/gu, " ")).toBe("Aug 2, 2026, 11:30 PM UTC");
  });

  it("names the day the instant falls on in the operator's zone, east and west", () => {
    expect(clientTextIn("Australia/Sydney", <OperatorDay iso={INSTANT} />)).toBe("3 Aug 2026");
    expect(clientTextIn("America/Los_Angeles", <OperatorDay iso={INSTANT} />)).toBe("2 Aug 2026");
    expect(clientTextIn("America/Los_Angeles", <OperatorDay iso={INSTANT} />)).toBe(
      formatDay(INSTANT, { locale: DEFAULT_LOCALE, timeZone: "America/Los_Angeles" }),
    );
  });

  it("gives the hook the same answer as the element, for times inside a sentence", () => {
    function Sentence() {
      const format = useOperatorDateTimeFormat();
      return <>{`Saved at ${format(INSTANT)}`}</>;
    }
    const sentence = clientTextIn("Australia/Sydney", <Sentence />);
    const element = clientTextIn("Australia/Sydney", <OperatorDateTime iso={INSTANT} />);
    expect(sentence).toBe(`Saved at ${element}`);
  });
});
