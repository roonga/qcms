import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import {
  assembleNativeDate,
  dateSegmentOrder,
  isoDateLocale,
  NATIVE_DATE_PART_PREFIX,
  NATIVE_FIELD_KIND_PREFIX,
  splitNativeDate,
} from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

// jsdom pins the markup contract: which elements carry which names, their order, and
// what the browser will validate. Whether the browser then submits is browser behaviour
// (ADR-23), asserted in the portal's own suite.

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");

const DATE_QUESTION = "q_dob";
const dateStep: A2UIStepDocument = kitchenSink.compiled.documents[0];

const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

function renderNative(values?: Record<string, string>, locale = "en-GB") {
  return render(
    <A2UIStepRenderer
      document={dateStep}
      values={values ?? {}}
      nativeSubmit={NATIVE}
      locale={locale}
    />,
  );
}

function boxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>("input[data-qcms-date-part]")];
}

const order = (container: HTMLElement) =>
  boxes(container).map((box) => box.dataset["qcmsDatePart"]);

describe("dateSegmentOrder", () => {
  it("reads the order from Intl, per locale", () => {
    expect(dateSegmentOrder("en-GB")).toEqual(["day", "month", "year"]);
    expect(dateSegmentOrder("en-US")).toEqual(["month", "day", "year"]);
    expect(dateSegmentOrder("de-DE")).toEqual(["day", "month", "year"]);
    expect(dateSegmentOrder("ja-JP")).toEqual(["year", "month", "day"]);
  });
});

describe("assembleNativeDate / splitNativeDate", () => {
  it("joins and pads digits into the ISO day the API reads", () => {
    expect(assembleNativeDate({ day: "7", month: "5", year: "1990" })).toBe("1990-05-07");
    expect(assembleNativeDate({ day: " 17 ", month: "05", year: "1990" })).toBe("1990-05-17");
  });

  it("is absence when every part is blank, and passes anything else through for the API", () => {
    expect(assembleNativeDate({ day: "", month: " ", year: "" })).toBeUndefined();
    expect(assembleNativeDate({})).toBeUndefined();
    // Neither completed nor dropped here: the API refuses it (R2).
    expect(assembleNativeDate({ day: "5", year: "1990" })).toBe("1990--05");
    expect(assembleNativeDate({ day: "x", month: "5", year: "1990" })).toBe("1990-05-x");
  });

  it("splits a stored or re-rendered value back into the boxes", () => {
    expect(splitNativeDate("1990-05-17")).toEqual({ year: "1990", month: "05", day: "17" });
    expect(splitNativeDate("1990--05")).toEqual({ year: "1990", month: "", day: "05" });
    expect(splitNativeDate(undefined)).toEqual({ year: "", month: "", day: "" });
    expect(splitNativeDate("nonsense")).toEqual({ year: "", month: "", day: "" });
  });
});

describe("the no-JS date control", () => {
  it("draws day, month, year for en-GB and month, day, year for en-US", () => {
    expect(order(renderNative(undefined, "en-GB").container)).toEqual(["day", "month", "year"]);
    expect(order(renderNative(undefined, "en-US").container)).toEqual(["month", "day", "year"]);
  });

  it("draws the same order in a server render as on the client", () => {
    for (const locale of ["en-GB", "en-US"]) {
      const html = renderToString(
        <A2UIStepRenderer document={dateStep} values={{}} nativeSubmit={NATIVE} locale={locale} />,
      );
      const serverOrder = [...html.matchAll(/data-qcms-date-part="(day|month|year)"/g)].map(
        (match) => match[1],
      );
      expect(serverOrder).toEqual(dateSegmentOrder(locale));
    }
  });

  it("posts each part under its own prefixed name and nothing under the bare name", () => {
    const { container } = renderNative();
    const names = boxes(container).map((box) => box.name);
    expect(names).toEqual([
      `${NATIVE_DATE_PART_PREFIX.day}${DATE_QUESTION}`,
      `${NATIVE_DATE_PART_PREFIX.month}${DATE_QUESTION}`,
      `${NATIVE_DATE_PART_PREFIX.year}${DATE_QUESTION}`,
    ]);
    const bare = [
      ...container.querySelectorAll<HTMLInputElement>(`input[name="${DATE_QUESTION}"]`),
    ];
    expect(bare.filter((input) => input.getAttribute("form") !== "")).toEqual([]);
  });

  it("renders boxes the browser can validate AND focus", () => {
    for (const box of boxes(renderNative().container)) {
      expect(box.required).toBe(true);
      expect(box.hasAttribute("hidden")).toBe(false);
      expect(box.type).toBe("text");
      expect(box.inputMode).toBe("numeric");
      expect(box.disabled).toBe(false);
    }
  });

  it("names the group by the question's label and each box by its part", () => {
    const { container } = renderNative();
    const fieldset = container.querySelector("fieldset[data-qcms-native-date]");
    expect(fieldset?.querySelector("legend")?.textContent).toContain("Date of birth");
    const labels = boxes(container).map(
      (box) => container.querySelector<HTMLLabelElement>(`label[for="${box.id}"]`)?.textContent,
    );
    expect(labels).toEqual(["Day", "Month", "Year"]);
  });

  it("seeds the stored answer into the three boxes, so it re-posts unchanged", () => {
    const values = boxes(renderNative({ [DATE_QUESTION]: "1990-05-17" }).container).map(
      (box) => box.value,
    );
    expect(values).toEqual(["17", "05", "1990"]);
  });

  it("tags the field `date` for the BFF decoder", () => {
    const { container } = renderNative();
    const kind = container.querySelector<HTMLInputElement>(
      `input[type="hidden"][name="${NATIVE_FIELD_KIND_PREFIX}${DATE_QUESTION}"]`,
    );
    expect(kind?.value).toBe("date");
  });

  it("shows the API's refusal in the field's own error slot", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={dateStep}
        errors={{ [DATE_QUESTION]: "That date is out of range." }}
        nativeSubmit={NATIVE}
      />,
    );
    const box = boxes(container)[0];
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const described = (box.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("That date is out of range.");
  });

  it("leaves the scripted render alone: no native boxes when JS drives the form", () => {
    const { container } = render(<A2UIStepRenderer document={dateStep} locale="en-GB" />);
    expect(boxes(container)).toEqual([]);
    expect(container.querySelectorAll('[role="spinbutton"]').length).toBeGreaterThan(0);
  });

  it("orders the scripted DateField's segments by the same locale", () => {
    for (const locale of ["en-GB", "en-US"]) {
      const { container, unmount } = render(
        <A2UIStepRenderer document={dateStep} locale={locale} />,
      );
      const scripted = [
        ...container.querySelectorAll<HTMLElement>('[role="spinbutton"][data-type]'),
      ]
        .map((segment) => segment.dataset["type"])
        .filter((type) => type === "day" || type === "month" || type === "year");
      expect(scripted).toEqual(dateSegmentOrder(locale));
      unmount();
    }
  });
});

// Without the forced calendar a non-Gregorian default drew the same stored value as a
// different date once hydrated, while the no-JS boxes kept posting Gregorian numbers.

describe("the calendar policy across both renders", () => {
  const NON_GREGORIAN = ["th-TH", "fa-IR", "zh-CN-u-ca-chinese", "en-US-u-ca-buddhist", "ar-EG"];

  it("forces the Gregorian calendar and Latin digits and keeps everything else", () => {
    expect(isoDateLocale("th-TH")).toBe("th-TH-u-ca-gregory-nu-latn");
    expect(isoDateLocale("zh-CN-u-ca-chinese")).toBe("zh-CN-u-ca-gregory-nu-latn");
    expect(isoDateLocale("fa-IR-u-nu-arabext")).toBe("fa-IR-u-ca-gregory-nu-latn");
    expect(isoDateLocale("en-GB")).toBe("en-GB-u-ca-gregory-nu-latn");
    expect(isoDateLocale("not a locale")).toBe("not a locale");
  });

  it.each(NON_GREGORIAN)("%s: the scripted field shows the stored day the boxes show", (locale) => {
    const native = renderNative({ [DATE_QUESTION]: "1990-05-17" }, locale);
    const nativeParts: Record<string, string> = {};
    for (const box of boxes(native.container))
      nativeParts[box.dataset["qcmsDatePart"] ?? ""] = box.value;
    const nativeOrder = order(native.container);
    native.unmount();
    expect(nativeParts).toEqual({ day: "17", month: "05", year: "1990" });

    const scripted = render(
      <A2UIStepRenderer
        document={dateStep}
        values={{ [DATE_QUESTION]: "1990-05-17" }}
        locale={locale}
      />,
    );
    const segments = [
      ...scripted.container.querySelectorAll<HTMLElement>('[role="spinbutton"][data-type]'),
    ]
      .filter((segment) => ["day", "month", "year"].includes(segment.dataset["type"] ?? ""))
      .map((segment) => ({ type: segment.dataset["type"] ?? "", text: segment.textContent ?? "" }));
    scripted.unmount();

    expect(segments.map(({ type }) => type)).toEqual(nativeOrder);
    const scriptedParts: Record<string, string> = {};
    for (const { type, text } of segments) scriptedParts[type] = text;
    for (const text of Object.values(scriptedParts)) expect(text).toMatch(/^\d+$/u);
    expect(Number(scriptedParts["day"])).toBe(17);
    expect(Number(scriptedParts["month"])).toBe(5);
    expect(Number(scriptedParts["year"])).toBe(1990);
  });

  it.each(NON_GREGORIAN)("%s: what is typed into the boxes posts as that ISO day", (locale) => {
    const { container, unmount } = renderNative({}, locale);
    const typed = { day: "17", month: "5", year: "1990" } as const;
    for (const box of boxes(container)) {
      box.value = typed[box.dataset["qcmsDatePart"] as keyof typeof typed];
    }
    const posted = new FormData(container.querySelector("form")!);
    unmount();
    const part = (name: string): string => {
      const value = posted.get(`${name}${DATE_QUESTION}`);
      return typeof value === "string" ? value : "";
    };
    expect(
      assembleNativeDate({
        day: part(NATIVE_DATE_PART_PREFIX.day),
        month: part(NATIVE_DATE_PART_PREFIX.month),
        year: part(NATIVE_DATE_PART_PREFIX.year),
      }),
    ).toBe("1990-05-17");
  });

  it("reads the order of a calendar extension's tag from its Gregorian form", () => {
    expect(dateSegmentOrder("zh-CN-u-ca-chinese")).toEqual(["year", "month", "day"]);
    expect(dateSegmentOrder("th-TH")).toEqual(["day", "month", "year"]);
    expect(dateSegmentOrder("fa-IR")).toEqual(["year", "month", "day"]);
  });
});
