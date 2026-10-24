import type { A2Node } from "@a2ra/core";

import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";
import { REPEAT_TABLE_NODE_TYPE } from "./repeat/repeat-table-node.ts";

/**
 * Native (no-JS) submit mode for the A2UI step renderer.
 *
 * The controlled renderer keeps its primary action outside the renderer as a
 * `type="button"` and drives every control from parent state, so a respondent with
 * JavaScript disabled can view a step and has nothing to submit. This is the opt-in
 * seam that makes one natively submittable: a real `<form method="post">`, uncontrolled
 * react-aria inputs whose native serialization carries the input, and a real
 * `type="submit"` control.
 *
 * ADR-18 holds: submittability is a render-time capability. `withNativeSubmit`
 * shallow-clones the root, and the persisted A2UI bytes are untouched.
 */

/** The registry type of the appended, render-time-only submit control. */
export const SUBMIT_NODE_TYPE = "SubmitButton";

/**
 * The hidden-input name prefix that tags each answer field with its wire kind, so the
 * BFF can decode form-encoded strings back to canonical answer shapes without knowing
 * the question definitions (R2: the renderer supplies the transport kind, the BFF stays
 * a dumb decoder). For question `q_x` the companion field is `__qk__q_x` and its value
 * is a {@link NativeFieldKind}.
 */
export const NATIVE_FIELD_KIND_PREFIX = "__qk__";

/**
 * The hidden-input name prefix that marks one answer field as currently answered, so
 * the BFF can tell a field submitted empty from one never answered.
 *
 * A native form posts a blank text box and a never-touched one identically, and posts
 * an all-unchecked checkbox group as nothing at all. The BFF holds no answer state
 * (R2), so it decoded both to absence: clearing a previously answered field was a
 * silent no-op, leaving the stale answer standing and rules evaluating on a value the
 * respondent believed gone. With the marker, an empty field beside it is an ADR-33
 * retraction, and the BFF stays a pure decoder of what was posted.
 *
 * For question `q_x` the companion field is `__qa__q_x` with the value
 * {@link NATIVE_FIELD_ANSWERED_VALUE}, as `type="hidden"`, so it is neither visible nor
 * focusable and carries no accessible name.
 *
 * The marker is respondent-editable, like every field in a form they own, and forging
 * one buys only retracting their own answer in their own session, which the answer
 * endpoint already permits. It confers no authority the API does not already grant.
 *
 * The browser still blocks emptying a required number or single choice before the form
 * leaves the page, so each clear is reachable only for an optional question.
 */
export const NATIVE_FIELD_ANSWERED_PREFIX = "__qa__";

/**
 * The value the {@link NATIVE_FIELD_ANSWERED_PREFIX} marker carries. Presence is the
 * whole signal and the content is never read, but a hidden input needs some value.
 */
export const NATIVE_FIELD_ANSWERED_VALUE = "1";

/**
 * The transport kind the BFF decoder keys off. Deliberately coarse: a serialization
 * hint, not the question type.
 *
 * - `string` - text / date / singleChoice / Select: the raw string, as-is.
 * - `number` - NumberField: coerce with `Number(...)`.
 * - `radio` - a RadioGroup: `"true"`/`"false"` decode to a JSON boolean (a boolean
 *   question), any other value stays a string (a singleChoice OptionId).
 * - `multi` - a CheckboxGroup: the array of selected string values.
 * - `date` - the no-JS date field's three parts, posted under
 *   {@link NATIVE_DATE_PART_PREFIX} names and assembled by {@link assembleNativeDate}.
 */
export type NativeFieldKind = "string" | "number" | "radio" | "multi" | "date";

/** The three parts of a calendar day, in no particular order. */
export type DatePart = "day" | "month" | "year";

/**
 * The name prefixes the no-JS date field's three inputs post under. For question `q_dob`
 * the day box is `__qdd__q_dob`, the month box `__qdm__q_dob` and the year box
 * `__qdy__q_dob`.
 *
 * Names are per part, never one repeated name: a repeated name posts its values in DOM
 * order, and that order is locale-dependent, so the decoder could not tell which value
 * was which.
 */
export const NATIVE_DATE_PART_PREFIX: Readonly<Record<DatePart, string>> = {
  day: "__qdd__",
  month: "__qdm__",
  year: "__qdy__",
};

/**
 * The locale every QCMS date is drawn, entered and formatted in: the operator's tag with
 * the Gregorian calendar and Latin digits forced (the ADR-27 amendment's calendar
 * policy).
 *
 * A date answer is an ISO-8601 day, so a locale whose default calendar is not Gregorian
 * would draw the same stored value as a different date, and the no-JS boxes post exactly
 * the numbers typed. Forcing both here, in the one function every render and formatter
 * calls, keeps the server render, the hydrated control and the stored answer on the same
 * date. The answer itself is never reinterpreted.
 *
 * Everything else the tag says stays the operator's, and a `-u-ca-` or `-u-nu-`
 * extension is overridden rather than refused. A string `Intl` cannot read is returned
 * as given, so the caller's own validation reports it.
 */
export function isoDateLocale(locale: string): string {
  try {
    return new Intl.Locale(locale, { calendar: "gregory", numberingSystem: "latn" }).toString();
  } catch {
    return locale;
  }
}

/**
 * The order a locale writes a calendar day's parts in, read from `Intl` in the
 * {@link isoDateLocale} form of the tag, so it is the order react-aria's DateField draws
 * under the same provider.
 *
 * Deterministic for a given tag: it never reads the runtime's own locale or zone, which
 * is what lets the server render and the hydrated render agree. `relatedYear` is read as
 * the year; only a non-Gregorian calendar emits it, which {@link isoDateLocale} prevents.
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
 * Join the three posted parts into the `YYYY-MM-DD` string the API reads, or
 * `undefined` when every part is blank.
 *
 * Coercion only, never a validity judgement (R2): digits are zero-padded to the ISO
 * widths, and anything else passes through as typed, so `31/02/2026` or a letter in the
 * year reaches the API as a string it refuses with its own message.
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
 * Split a stored or re-rendered value back into the three boxes. A well-formed ISO day
 * fills all three; anything else that still has two hyphens fills them as typed, so a
 * refused post re-renders with what the respondent wrote; the rest renders blank.
 */
export function splitNativeDate(value: string | undefined): Readonly<Record<DatePart, string>> {
  const match = value === undefined ? null : /^([^-]*)-([^-]*)-([^-]*)$/.exec(value);
  if (match === null) return { day: "", month: "", year: "" };
  return { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" };
}

/**
 * A Next Server Action, as React renders it into a `<form action>`. Typed structurally
 * rather than imported, because `@roonga/qcms-ui` depends on no framework.
 */
export type NativeFormAction = (formData: FormData) => void;

/** Options that turn the renderer into its natively-submittable mode (opt-in). */
export interface NativeSubmitOptions {
  /** The same-origin BFF route the native `<form>` POSTs to. */
  readonly action: string;
  /** The form method; only `post` is meaningful for an answer submission. */
  readonly method?: "post";
  /** The visible label of the real submit control. */
  readonly submitLabel: string;
  /** Optional class for the submit control, so the host app themes it (ADR-26). */
  readonly submitClassName?: string;
  /**
   * The form's own action, when the step carries a repeating group (ADR-43 as amended):
   * a Server Action that applies Add or Remove and re-renders the step in the same 200.
   *
   * One form reaches two destinations without scripting, and the action sits on the form
   * with a plain URL `formaction` on Continue rather than on each `__qop` button, so
   * React stays away from those buttons: a plain `<button name value>` contributes its
   * pair only when it is the submitter, with no framework behaviour to rely on.
   *
   * It cannot ride the A2UI node's props, which carry stored, serialisable data only, so
   * it travels in the field context, the seam `values` and `errors` use. Absent, the
   * node carries the string `action` and the submit control carries no `formaction`.
   */
  readonly formAction?: NativeFormAction;
  /**
   * Hidden inputs to render as the form's first children, as `{ name: value }`.
   *
   * This is how a Server Action gets its per-request context without being bound: a
   * bound action cannot go to `useActionState`, because Next compares a bound
   * reference's signature asynchronously and that comparison never settles inside a
   * server render, so the POST never gets a response and the process dies accumulating
   * promises.
   *
   * These names are the host's, and its decoder has to reserve them so they are not
   * mistaken for answers.
   */
  readonly hiddenFields?: Readonly<Record<string, string>>;
}

function toChildArray(children: A2Node["children"]): A2Node[] {
  if (children === undefined) return [];
  if (typeof children === "string") return [];
  return Array.isArray(children) ? [...children] : [children];
}

/**
 * Whether the tree carries a repeating group in either presentation, which is what puts
 * `__qop` submit buttons (Remove, Add) into the same form as the submit control.
 */
function carriesRosterButtons(node: A2Node): boolean {
  if (node.type === REPEAT_GROUP_NODE_TYPE || node.type === REPEAT_TABLE_NODE_TYPE) return true;
  return toChildArray(node.children).some((child) => carriesRosterButtons(child));
}

/**
 * Return a render-time copy of the step's root that is natively submittable: the root
 * gains `action`/`method` and a `SubmitButton` is appended as its last child. The input
 * `root` is never mutated (ADR-18).
 *
 * When the tree carries a repeating group, a hidden copy of the submit node is also
 * prepended, so Enter in a field continues rather than pressing a `__qop` Remove or Add.
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
