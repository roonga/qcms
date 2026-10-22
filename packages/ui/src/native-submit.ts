import type { A2Node } from "@a2ra/core";

import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";
import { REPEAT_TABLE_NODE_TYPE } from "./repeat/repeat-table-node.ts";

/**
 * Native (no-JS) submit mode for the A2UI step renderer (task 044).
 *
 * The controlled renderer (028/029) owns the step `<form>` but renders its
 * primary action OUTSIDE the renderer as a `type="button"`, and each control is
 * a *controlled* react-aria input driven by parent state - so a respondent with
 * JavaScript disabled can VIEW a step but has nothing to submit. This module is
 * the opt-in seam that makes a step natively submittable: a real
 * `<form method="post" action=...>` the browser POSTs without JS, react-aria
 * inputs rendered *uncontrolled* (so their native form serialization carries the
 * user's input), and a real `type="submit"` control.
 *
 * ADR-18 is respected: the submittability is a *render-time* capability, never a
 * change to the stored compiled document. `withNativeSubmit` shallow-clones the
 * step's root at render time to inject the form `action`/`method` and append the
 * submit control; the persisted A2UI bytes are untouched (exactly as
 * `documentForVisible` already prunes at render time in the portal).
 */

/** The registry type of the appended, render-time-only submit control. */
export const SUBMIT_NODE_TYPE = "SubmitButton";

/**
 * The hidden-input name prefix that tags each answer field with its wire kind, so
 * the strict BFF can decode form-encoded strings back to canonical answer shapes
 * (boolean/number/...) WITHOUT knowing the question definitions (R2 stays intact:
 * the renderer, which knows each control's semantics, provides the transport kind;
 * the BFF is a dumb decoder). For question `q_x` the companion field is
 * `__qk__q_x` and its value is a {@link NativeFieldKind}.
 */
export const NATIVE_FIELD_KIND_PREFIX = "__qk__";

/**
 * The hidden-input name prefix that marks one answer field as **currently
 * answered**, so the strict BFF can tell "this field was submitted empty" from
 * "this field was never answered" (issue #127, Code Owner ruling 2026-09-02).
 *
 * ## The hole it closes
 *
 * A native form posts a blank text box and a never-touched one identically, and
 * posts an all-unchecked checkbox group as nothing at all. So the BFF, which under
 * R2 holds no answer state and cannot ask whether a question had an answer, decoded
 * both to absence and omitted them. On the scripted path an emptied control is an
 * ADR-33 retraction (issue #98); on the native path it was a silent no-op, so a
 * respondent who cleared a previously answered field submitted with the stale answer
 * still standing and any rule reading it evaluating on a value they believed gone.
 *
 * ## Why the marker is the right shape
 *
 * The renderer already knows which questions hold an answer - it seeds their
 * controls from `values` - so this makes an existing, respondent-visible signal
 * explicit and machine-readable rather than disclosing anything new. The BFF stays
 * a pure decoder of what was posted (no prior-state diffing, no rule evaluation),
 * and the API's submit semantics are untouched, so partial submits are unaffected.
 *
 * For question `q_x` the companion field is `__qa__q_x` with the value
 * {@link NATIVE_FIELD_ANSWERED_VALUE}. It is `type="hidden"`, so it is not visible,
 * not focusable and carries no accessible name.
 *
 * ## What a forged marker can and cannot do
 *
 * The marker is respondent-editable, like every other field in a form they own. The
 * worst it buys is retracting their own answer inside their own session, which is
 * exactly what the scripted path already lets them do by posting `null` to the
 * answer endpoint. It confers no authority the API does not already grant, and a
 * retraction of a question that holds no answer is a documented no-op.
 *
 * ## Every control reaches this seam now, the NumberField and the Select last
 *
 * The NumberField used to be exempt by construction (issue #18): react-aria carried
 * its form value in a hidden input that JavaScript syncs, so with scripting off a
 * respondent's edit never reached the wire and the seeded answer is what
 * serialized. A marked number could not arrive empty, so it could not retract, and
 * the no-JS path could not clear a number at all. Native mode now renders
 * `NativeNumberField`, a real `<input type="number">` under the question's own name
 * (Code Owner ruling, 2026-09-19), so an emptied number posts empty exactly like an
 * emptied text box and the rule above covers it with no change.
 *
 * The Select was exempt for a different reason (issue #988): it had no clear GESTURE
 * rather than no wire. Its form value did ride a real `<select>` under the question's
 * own name, but clipped inside an `aria-hidden` container behind a JS-only trigger,
 * and react-aria will not let a chosen key be deselected in any case. Native mode
 * renders `NativeSelectField`, a real visible `<select>` whose first option is
 * empty-valued, so returning to it posts empty beside the marker and reaches this
 * rule like every other clear. That gesture exists on this path ALONE; the scripted
 * control still has none.
 *
 * What the BROWSER still refuses is unchanged and is the #920 ruling, not this
 * seam: emptying a REQUIRED number or single choice is blocked before the form
 * leaves the page, so each clear is reachable only for an optional one
 * (`q_annual_km` and `q_overnight_parking` in the vehicle kitchen-sink fixture).
 */
export const NATIVE_FIELD_ANSWERED_PREFIX = "__qa__";

/**
 * The value the {@link NATIVE_FIELD_ANSWERED_PREFIX} marker carries. Its content is
 * never read - presence is the whole signal - but a hidden input needs some value,
 * and a constant keeps the renderer and the decoder's tests naming one thing.
 */
export const NATIVE_FIELD_ANSWERED_VALUE = "1";

/**
 * The transport kind the BFF decoder keys off. Deliberately coarse - it is a
 * serialization hint, not the question type:
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
 * The name prefixes the no-JS date field's three inputs post under
 * (Code Owner ruling 2026-10-19, ADR-27 amendment). For question `q_dob` the day box is
 * `__qdd__q_dob`, the month box `__qdm__q_dob` and the year box `__qdy__q_dob`.
 *
 * ## Why three boxes rather than `<input type="date">`
 *
 * A native date input draws its day, month and year in the order of the BROWSER's own
 * locale, and no attribute moves it (`lang` is ignored for this). The hydrated control
 * is react-aria's DateField, whose order follows the `I18nProvider` locale the portal
 * names from `QCMS_LOCALE`. So a respondent on an en-GB deployment whose browser was
 * en-US saw month/day/year in the server render and day/month/year after hydration, or
 * the reverse. Three labelled boxes in the configured order are the only native markup
 * whose order the server decides, so the two renders agree by construction.
 *
 * Names are per part, never one repeated name: a repeated name posts its values in DOM
 * order, and the DOM order is locale-dependent, so the decoder could not tell which
 * value was which.
 */
export const NATIVE_DATE_PART_PREFIX: Readonly<Record<DatePart, string>> = {
  day: "__qdd__",
  month: "__qdm__",
  year: "__qdy__",
};

/**
 * The locale every QCMS date is drawn, entered and formatted in: the operator's tag with
 * the **Gregorian calendar and Latin digits** forced: the explicit calendar policy the
 * operator-locale change records in its ADR-27 amendment, made to satisfy that ruling's
 * requirement that the server render and the hydrated render agree.
 *
 * ## Why the calendar and the digits are not the operator's to choose
 *
 * A date answer is an ISO-8601 day, `YYYY-MM-DD`, which is a Gregorian date written in
 * ASCII digits, and every instant the apps show is stored the same way. A locale whose
 * default calendar is not Gregorian would otherwise draw that same value as a different
 * date: `th-TH` shows 1990 as the Buddhist year 2533, `fa-IR` shows 17 May 1990 as
 * 27/2/1369 in Persian digits, and an explicit extension such as `-u-ca-chinese` changes
 * the parts and their order. The no-JS boxes post exactly the numbers typed, so a
 * respondent who typed the year they saw on one render would have answered a different
 * date on the other. Forcing the calendar and the digits here, in the one function both
 * renders and both apps' formatters call, keeps the server render, the hydrated
 * react-aria control and the stored answer on the same date. The answer is never
 * reinterpreted: it stays the ISO day it always was.
 *
 * What stays the operator's: the order of the parts, month names, separators, the hour
 * cycle, list words and every other convention of the tag. A `-u-ca-` or `-u-nu-`
 * extension the operator wrote is overridden rather than refused, because the tag is
 * still a valid choice for everything else it says. A string `Intl` cannot read is
 * returned as given, so the caller's own validation reports it.
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
 * A Next Server Action, as React renders it into a `<form action>` (task 073).
 *
 * Typed structurally rather than imported, because `@roonga/qcms-ui` depends on no
 * framework: what React needs is a function it can recognise as a form action, and
 * what the host supplies is `useActionState`'s second return value.
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
   * The **form's own** action, when the step carries a repeating group (task 073,
   * ADR-43 as amended, Code Owner 2026-10-01): a Next Server Action that applies the
   * respondent's Add or Remove and re-renders the step in the same 200 response.
   *
   * ## Why the form and not the buttons
   *
   * One form has to reach two destinations without scripting: Continue goes to the
   * whole-step BFF route and answers a 303, and an Add or Remove goes to the Server
   * Action and answers a 200 carrying the typed values back. HTML's mechanism for that
   * is `formaction` on the submit control, and there are two ways round:
   *
   * - the action on the **form** and a plain URL `formaction` on the Continue control,
   *   which is what this is;
   * - the action on each `__qop` **button** through `formAction`.
   *
   * The first is chosen because it puts React nowhere near the `__qop` buttons. Those
   * buttons carry `name="__qop"` and a value, which is the ruled mechanism (Q9), and a
   * plain `<button name value>` contributes its pair to the form data set only when it
   * is the submitter - pure HTML, no framework behaviour to rely on. It is also the
   * shape React documents progressive enhancement for: the hidden action fields are
   * rendered into the form, so a scripting-disabled browser posts them.
   *
   * When this is absent the renderer behaves exactly as it did before task 073: the
   * node carries the string `action` and the submit control carries no `formaction`.
   * A step with no repeating group therefore renders byte-identically.
   *
   * It does **not** ride the A2UI node's props, and it cannot: a node's props are the
   * stored document's data, validated by a Zod schema and serialisable by construction.
   * It travels in the field context instead, which is the same seam `values` and
   * `errors` use.
   */
  readonly formAction?: NativeFormAction;
  /**
   * Hidden inputs to render as the form's first children, as `{ name: value }`.
   *
   * This is how a Server Action gets its per-request context without being bound. A
   * bound action cannot go to `useActionState`: Next compares a bound reference's
   * signature asynchronously and that comparison never settles inside a server render,
   * so the POST never gets a response and the process accumulates promises until it dies
   * with `RangeError: Map maximum size exceeded`. A hidden input is the plain-HTML way to
   * carry the same value, and it posts with every submit of the form including Continue.
   *
   * These names are the host's, and the host's own decoder has to reserve them so they
   * are not mistaken for answers.
   */
  readonly hiddenFields?: Readonly<Record<string, string>>;
}

/** Normalize an `A2Node`'s `children` union to a plain array of child nodes. */
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
 * Return a render-time copy of the step's root that is natively submittable:
 * the (compiled `Form`) root gains `action`/`method`, and a `SubmitButton` node
 * is appended as its last child. The input `root` is never mutated (ADR-18); this
 * is the same render-time shaping the portal already does when it prunes to the
 * visible questions.
 *
 * When the tree carries a repeating group, a hidden copy of that node is also
 * prepended as the first child, so Enter in a field continues rather than pressing a
 * `__qop` Remove or Add (local UX list P3).
 *
 * A non-`Form` root (never produced by the compiler, but the type allows it) is
 * returned untouched apart from the appended submit control, since only a `<form>`
 * can carry `action`/`method`.
 */
export function withNativeSubmit(root: A2Node, opts: NativeSubmitOptions): A2Node {
  const submitProps: Record<string, unknown> = { label: opts.submitLabel };
  if (opts.submitClassName !== undefined) submitProps.className = opts.submitClassName;
  // With a Server Action on the form (task 073), the submit control is what keeps
  // Continue pointed at the BFF route: `formaction` on a submit button overrides the
  // form's action for that button alone, and it is a plain URL string, so a
  // scripting-disabled browser follows it with no framework involvement.
  if (opts.formAction !== undefined) submitProps.formAction = opts.action;
  const submitNode: A2Node = { type: SUBMIT_NODE_TYPE, props: submitProps };

  const props: Record<string, unknown> = {
    ...(root.props ?? {}),
    method: opts.method ?? "post",
  };
  // The node's `action` is the string the vendored `Form` renders. It is omitted when
  // a Server Action is supplied, because the action is a function and a node prop
  // carries stored, serialisable data only: the adapter reads the function from the
  // field context instead.
  if (opts.formAction === undefined) props.action = opts.action;
  // Enter in a text, number or date field submits through the form's default button,
  // which is the FIRST submit button in tree order, and the submit control is appended
  // last. On a step with a repeating group every Remove and Add precedes it, so Enter
  // would remove or add an instance instead of continuing (local UX list P3). A hidden
  // copy built from the same props goes first, so it mirrors the real control by
  // construction. A step with no group carries no other submit button and is unchanged.
  const leading: A2Node[] = carriesRosterButtons(root)
    ? [{ type: SUBMIT_NODE_TYPE, props: { ...submitProps, implicitDefault: true } }]
    : [];
  return { ...root, props, children: [...leading, ...toChildArray(root.children), submitNode] };
}
