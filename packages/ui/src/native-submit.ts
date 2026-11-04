import type { A2Node } from "@a2ra/core";

import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";
import { REPEAT_TABLE_NODE_TYPE } from "./repeat/repeat-table-node.ts";

/** Native submission is a render-time capability; persisted A2UI bytes must remain unchanged. */

export const SUBMIT_NODE_TYPE = "SubmitButton";

/**
 * Lets the BFF decode form-encoded strings back to canonical answer shapes without
 * knowing the question definitions (R2). For `q_x` the companion is `__qk__q_x`.
 */
export const NATIVE_FIELD_KIND_PREFIX = "__qk__";

/**
 * Native forms cannot distinguish untouched from cleared values without this answered marker.
 * Forging one can only retract the caller's own answer, which the answer API already permits.
 */
export const NATIVE_FIELD_ANSWERED_PREFIX = "__qa__";

/** Presence is the whole signal, but a hidden input needs some value. */
export const NATIVE_FIELD_ANSWERED_VALUE = "1";

/**
 * Deliberately coarse: a serialization hint, not the question type. `radio` decodes
 * `"true"`/`"false"` to a JSON boolean and anything else to an OptionId string.
 */
export type NativeFieldKind = "string" | "number" | "radio" | "multi" | "date";

export type DatePart = "day" | "month" | "year";

/**
 * Per part, never one repeated name: a repeated name posts its values in DOM order,
 * and that order is locale-dependent, so the decoder could not tell which was which.
 */
export const NATIVE_DATE_PART_PREFIX: Readonly<Record<DatePart, string>> = {
  day: "__qdd__",
  month: "__qdm__",
  year: "__qdy__",
};

/**
 * Force Gregorian calendar and Latin digits so ISO dates survive locale changes.
 * Return invalid tags unchanged for caller validation.
 */
export function isoDateLocale(locale: string): string {
  try {
    return new Intl.Locale(locale, { calendar: "gregory", numberingSystem: "latn" }).toString();
  } catch {
    return locale;
  }
}

/**
 * Deterministic for a given tag: it never reads the runtime's own locale or zone, which
 * is what lets the server render and the hydrated render agree.
 */
export function dateSegmentOrder(locale: string): readonly DatePart[] {
  const parts = new Intl.DateTimeFormat(isoDateLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(2000, 10, 22)));
  const order: DatePart[] = [];
  for (const part of parts) {
    // `relatedYear` is missing from older lib typings, hence the widening to string.
    const type = (part.type as string) === "relatedYear" ? "year" : part.type;
    if ((type === "day" || type === "month" || type === "year") && !order.includes(type)) {
      order.push(type);
    }
  }
  return order.length === 3 ? order : ["day", "month", "year"];
}

/**
 * Coercion only, never a validity judgement (R2): anything that is not digits passes
 * through as typed, so the API refuses it with its own message.
 */
export function assembleNativeDate(
  parts: Readonly<Partial<Record<DatePart, string>>>,
): string | undefined {
  const day = (parts.day ?? "").trim();
  const month = (parts.month ?? "").trim();
  const year = (parts.year ?? "").trim();
  if (day === "" && month === "" && year === "") return undefined;
  const pad = (value: string, width: number): string =>
    /^\d+$/.test(value) && value.length < width ? value.padStart(width, "0") : value;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Anything with two hyphens fills the boxes as typed, so a refused post re-renders
 * with what the respondent wrote rather than blank.
 */
export function splitNativeDate(value: string | undefined): Readonly<Record<DatePart, string>> {
  const match = value === undefined ? null : /^([^-]*)-([^-]*)-([^-]*)$/.exec(value);
  if (match === null) return { day: "", month: "", year: "" };
  return { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" };
}

/** Typed structurally rather than imported, because this package needs no framework. */
export type NativeFormAction = (formData: FormData) => void;

/** Opting in turns the renderer's output into a natively submittable form. */
export interface NativeSubmitOptions {
  /** A same-origin BFF route. */
  readonly action: string;
  readonly method?: "post";

  readonly submitLabel: string;

  readonly submitClassName?: string;
  /**
   * A Server Action that applies Add or Remove and re-renders the step in the same 200 (ADR-43). It sits on the
   * form, with a plain URL `formaction` on Continue, so React stays off the `__qop` buttons. It cannot ride the
   * node's props, which carry stored serialisable data only.
   */
  readonly formAction?: NativeFormAction;
  /**
   * Bound Server Actions can hang useActionState during server rendering.
   * Pass request context through host-reserved hidden field names instead.
   */
  readonly hiddenFields?: Readonly<Record<string, string>>;
}

function toChildArray(children: A2Node["children"]): A2Node[] {
  if (children === undefined) return [];
  if (typeof children === "string") return [];
  return Array.isArray(children) ? [...children] : [children];
}

function carriesRosterButtons(node: A2Node): boolean {
  if (node.type === REPEAT_GROUP_NODE_TYPE || node.type === REPEAT_TABLE_NODE_TYPE) return true;
  return toChildArray(node.children).some((child) => carriesRosterButtons(child));
}

/**
 * The input `root` is never mutated (ADR-18). With a repeating group, a hidden copy of
 * the submit node is prepended so Enter continues rather than pressing Remove or Add.
 */
export function withNativeSubmit(root: A2Node, opts: NativeSubmitOptions): A2Node {
  const submitProps: Record<string, unknown> = { label: opts.submitLabel };
  if (opts.submitClassName !== undefined) submitProps.className = opts.submitClassName;
  // With a Server Action on the form, `formaction` on the submit control is what keeps
  // Continue pointed at the BFF route: a plain URL a scripting-disabled browser follows.
  if (opts.formAction !== undefined) submitProps.formAction = opts.action;
  const submitNode: A2Node = { type: SUBMIT_NODE_TYPE, props: submitProps };

  const props: Record<string, unknown> = {
    ...(root.props ?? {}),
    method: opts.method ?? "post",
  };
  // Omitted when a Server Action is supplied: a node prop carries stored, serialisable
  // data only, so the adapter reads the function from the field context instead.
  if (opts.formAction === undefined) props.action = opts.action;
  // The first submit button handles Enter; prepend Continue so roster buttons cannot become the default.
  const leading: A2Node[] = carriesRosterButtons(root)
    ? [{ type: SUBMIT_NODE_TYPE, props: { ...submitProps, implicitDefault: true } }]
    : [];
  return { ...root, props, children: [...leading, ...toChildArray(root.children), submitNode] };
}
