import type { A2Node } from "@a2ra/core";

import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";
import { REPEAT_TABLE_NODE_TYPE } from "./repeat/repeat-table-node.ts";

/**
 * The controlled renderer keeps its primary action outside the renderer and drives
 * every control from parent state, so a respondent with scripting disabled can view a
 * step and has nothing to submit. Submittability is a render-time capability only, so
 * the persisted A2UI bytes stay untouched (ADR-18).
 */

/** The registry type of the appended, render-time-only submit control. */
export const SUBMIT_NODE_TYPE = "SubmitButton";

/**
 * Lets the BFF decode form-encoded strings back to canonical answer shapes without
 * knowing the question definitions (R2). For `q_x` the companion is `__qk__q_x`.
 */
export const NATIVE_FIELD_KIND_PREFIX = "__qk__";

/**
 * A native form posts a blank text box and a never-touched one identically, and an unchecked checkbox group as
 * nothing, so the BFF (which holds no answer state, R2) decoded both to absence. An empty field beside this
 * marker is an ADR-33 retraction instead; for `q_x` it is `__qa__q_x`. Forging one only retracts your own
 * answer in your own session, which the answer endpoint already permits.
 */
export const NATIVE_FIELD_ANSWERED_PREFIX = "__qa__";

/** Presence is the whole signal, but a hidden input needs some value. */
export const NATIVE_FIELD_ANSWERED_VALUE = "1";

/**
 * Deliberately coarse: a serialization hint, not the question type. `radio` decodes
 * `"true"`/`"false"` to a JSON boolean and anything else to an OptionId string.
 */
export type NativeFieldKind = "string" | "number" | "radio" | "multi" | "date";

/** The three parts of a calendar day. */
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
 * The operator's tag with the Gregorian calendar and Latin digits forced (ADR-27): a date answer is an ISO-8601
 * day, so a locale with another default calendar would draw the same value as a different date. An unreadable
 * tag is returned as given, so the caller's validation reports it.
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
  /** The visible label of the real submit control. */
  readonly submitLabel: string;
  /** Host-app theming (ADR-26). */
  readonly submitClassName?: string;
  /**
   * A Server Action that applies Add or Remove and re-renders the step in the same 200 (ADR-43). It sits on the
   * form, with a plain URL `formaction` on Continue, so React stays off the `__qop` buttons. It cannot ride the
   * node's props, which carry stored serialisable data only.
   */
  readonly formAction?: NativeFormAction;
  /**
   * How a Server Action gets its per-request context without being bound: a bound
   * action cannot go to `useActionState`, because the signature comparison never
   * settles inside a server render and the process dies accumulating promises.
   *
   * These names are the host's, and its decoder has to reserve them.
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
  // Enter submits through the form's first submit button in tree order, and the real
  // control is appended last, so on a step with a repeating group Enter would press a
  // Remove or Add. A hidden copy built from the same props goes first instead.
  const leading: A2Node[] = carriesRosterButtons(root)
    ? [{ type: SUBMIT_NODE_TYPE, props: { ...submitProps, implicitDefault: true } }]
    : [];
  return { ...root, props, children: [...leading, ...toChildArray(root.children), submitNode] };
}
