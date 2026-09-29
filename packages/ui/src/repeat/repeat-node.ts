/**
 * The two repeat node types and the wire vocabulary the roster operation rides on
 * (task 073, ADR-42, ADR-43).
 *
 * This module is **React-free and dependency-free on purpose**, exactly as
 * `native-submit.ts` is: the portal's server-only BFF decoder imports the `__qop`
 * vocabulary from it, and a Server Component must not pull a client component into
 * its graph through a transitive import.
 */

/**
 * The compiler's template node: one repeating group, carrying its member controls
 * **once** with the bare `questionId` as each `name`
 * (`@roonga/qcms-a2ui-compiler`'s `repeat-group.ts`).
 */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/**
 * One live instance of a group, produced by {@link expandRepeatGroups} at render
 * time and never by the compiler. It is the `Honeypot` and `SubmitButton`
 * precedent's third case: a qcms-owned node type the stored bytes never carry.
 */
export const REPEAT_INSTANCE_NODE_TYPE = "RepeatInstance";

/**
 * The separator between an instance id and a question id in a field name:
 * `ins_7k2/q_passport` (Q15, ruled 2026-09-29; `ANSWER_KEY_SEPARATOR` in
 * `@roonga/qcms-core`).
 *
 * It is spelled here rather than imported because this package does not depend on
 * the kernel, and `@roonga/qcms-ui`'s import-surface test keeps it that way. The two
 * constants are one contract and a test asserts they agree.
 */
export const INSTANCE_NAME_SEPARATOR = "/";

/**
 * The reserved form-field name a roster operation posts under: the **fourth**
 * reserved prefix on the no-JS wire, beside `__qk__`, `__qa__` and the honeypot's
 * `website`.
 *
 * A `<button name value>` contributes its name and value to the form data set **only
 * when it is the button that submitted the form**, which is what lets one step form
 * carry several distinct operations with no scripting at all (ADR-43, Q9). So a
 * whole-step POST carries every field on the step plus **at most one** `__qop`
 * entry, or none.
 */
export const ROSTER_OP_FIELD = "__qop";

/** The two roster operations a respondent can ask for. */
export const ROSTER_OPS = ["add", "remove"] as const;
export type RosterOp = (typeof ROSTER_OPS)[number];

/**
 * One decoded `__qop` value.
 *
 * `token` is the **one-time operation token** the rendered page minted into the
 * button's value (ADR-43). The API records it with the roster row it writes, so a
 * replayed post - a reload of the 200 re-render, or a Back that resubmits - applies
 * nothing and returns the roster it already has. It is not a credential: it is
 * scoped to the session it was minted in, it is worthless to anyone who cannot
 * already post to that session, and refusing a replay is its only job.
 */
export interface RosterOpRequest {
  readonly op: RosterOp;
  readonly groupId: string;
  /** Present for `remove` only: which instance the respondent took out. */
  readonly instanceId?: string;
  readonly token: string;
}

/** The `:`-joined button value: `add:grp_passengers:op_7f3`, `remove:grp_x:ins_y:op_z`. */
export function rosterOpValue(request: RosterOpRequest): string {
  const parts: string[] =
    request.op === "remove"
      ? [request.op, request.groupId, request.instanceId ?? "", request.token]
      : [request.op, request.groupId, request.token];
  return parts.join(":");
}

/**
 * Decode a `__qop` value, or `undefined` when it is not one.
 *
 * Total over hostile input: a respondent can type any bytes into the form, so this
 * refuses anything that is not exactly the shape {@link rosterOpValue} writes. The
 * ids are checked only for **shape** here (non-empty, separator-free); whether a
 * group exists in the pinned form version and whether an instance belongs to this
 * session are the API's to decide, and it decides them against the snapshot and the
 * roster rather than against a regular expression.
 */
export function parseRosterOpValue(raw: string): RosterOpRequest | undefined {
  const parts = raw.split(":");
  const op = parts[0];
  if (op !== "add" && op !== "remove") return undefined;
  const expected = op === "remove" ? 4 : 3;
  if (parts.length !== expected) return undefined;
  if (parts.some((part) => part === "")) return undefined;
  const groupId = parts[1];
  return op === "remove"
    ? { op, groupId, instanceId: parts[2], token: parts[3] }
    : { op, groupId, token: parts[2] };
}

/**
 * The field name one question carries inside one instance:
 * `ins_7k2/q_passport`.
 *
 * **This is the field's whole identity everywhere below the API** (ADR-43). Every
 * place that keys on `name` today - `documentForVisible`'s pruning, the portal's
 * `commitMoments`, the `FieldBlur` wrapper's `id` and `data-qcms-field`, each
 * adapter's `key`, the `__qk__` and `__qa__` markers, the BFF decoder and the error
 * summary's anchors - keeps keying on one opaque string, and none of them learns
 * that instances exist.
 */
export function qualifiedFieldName(instanceId: string, questionId: string): string {
  return `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`;
}

/** The one placeholder an instance-label template carries: the live ordinal. */
export const INSTANCE_ORDINAL_PLACEHOLDER = "{n}";

/**
 * Resolve an instance label from its template and the instance's **live** one-based
 * ordinal: "Vehicle {n}" at ordinal 2 is "Vehicle 2".
 *
 * The ordinal is the instance's position in the live roster and is recomputed after
 * a removal, so it is presentation and never identity (ADR-42): the `ins_` id is
 * what joins. A template carrying no `{n}` is legal (a group of one) and resolves to
 * itself.
 *
 * The replacement is a **function** rather than a string, because `String.replace`
 * expands `$&`, `$1` and their friends inside a replacement string and an ordinal is
 * a digit.
 */
export function instanceLabelFor(template: string, ordinal: number): string {
  const text = String(ordinal);
  return template.replaceAll(INSTANCE_ORDINAL_PLACEHOLDER, () => text);
}

/** The `{label}` placeholder the compiled `removeLabel` carries. */
export const REMOVE_LABEL_PLACEHOLDER = "{label}";

/** "Remove {label}" at "Vehicle 2" is "Remove Vehicle 2" (APG: distinguishing words first). */
export function removeLabelFor(template: string, instanceLabel: string): string {
  return template.replaceAll(REMOVE_LABEL_PLACEHOLDER, () => instanceLabel);
}
