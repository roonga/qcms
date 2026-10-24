/**
 * The repeat node types and the wire vocabulary a roster operation rides on
 * (ADR-42, ADR-43).
 *
 * React-free and dependency-free on purpose: the portal's server-only BFF decoder
 * imports the `__qop` vocabulary from here, and a Server Component must not pull a
 * client component into its graph through a transitive import.
 */

/**
 * The compiler's template node: one repeating group, carrying its member controls
 * once with the bare `questionId` as each `name`.
 */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/**
 * One live instance of a group, produced at render time and never by the compiler:
 * a qcms-owned node type the stored bytes never carry.
 */
export const REPEAT_INSTANCE_NODE_TYPE = "RepeatInstance";

/**
 * The separator between an instance id and a question id in a field name:
 * `ins_7k2/q_passport`.
 *
 * Spelled here rather than imported, because this package does not depend on the
 * kernel and the import-surface test keeps it that way. It and the kernel's
 * `ANSWER_KEY_SEPARATOR` are one contract, and a test asserts they agree.
 */
export const INSTANCE_NAME_SEPARATOR = "/";

/**
 * The reserved form-field name a roster operation posts under, beside `__qk__`,
 * `__qa__` and the honeypot's `website`.
 *
 * A `<button name value>` contributes its pair to the form data set only when it is
 * the button that submitted the form, which is what lets one step form carry several
 * distinct operations with no scripting (ADR-43). So a whole-step POST carries every
 * field on the step plus at most one `__qop` entry.
 */
export const ROSTER_OP_FIELD = "__qop";

/** The two roster operations a respondent can ask for. */
export const ROSTER_OPS = ["add", "remove"] as const;
export type RosterOp = (typeof ROSTER_OPS)[number];

/**
 * One decoded `__qop` value.
 *
 * `token` is the one-time operation token the rendered page minted into the button's
 * value (ADR-43). The API records it with the roster row it writes, so a replayed
 * post applies nothing and returns the roster it already has. It is not a
 * credential: it is scoped to the session it was minted in and refusing a replay is
 * its only job.
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
 * refuses anything that is not exactly the shape {@link rosterOpValue} writes. Only
 * shape is checked here; whether a group exists in the pinned version and whether an
 * instance belongs to this session are the API's to decide, against the snapshot and
 * the roster rather than against a regular expression.
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
 * The field name one question carries inside one instance: `ins_7k2/q_passport`.
 *
 * This is the field's whole identity everywhere below the API (ADR-43), so every
 * place that keys on `name` keeps keying on one opaque string and none of them
 * learns that instances exist.
 */
export function qualifiedFieldName(instanceId: string, questionId: string): string {
  return `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`;
}

/** The one placeholder an instance-label template carries: the live ordinal. */
export const INSTANCE_ORDINAL_PLACEHOLDER = "{n}";

/**
 * Resolve an instance label from its template and the instance's live one-based
 * ordinal: "Vehicle {n}" at ordinal 2 is "Vehicle 2".
 *
 * The ordinal is recomputed after a removal, so it is presentation and never
 * identity (ADR-42): the `ins_` id is what joins. A template carrying no `{n}` is
 * legal and resolves to itself.
 *
 * The replacement is a function rather than a string, because a replacement string
 * expands `$&` and `$1` and an ordinal is a digit.
 */
export function instanceLabelFor(template: string, ordinal: number): string {
  const text = String(ordinal);
  return template.replaceAll(INSTANCE_ORDINAL_PLACEHOLDER, () => text);
}

/** The `{label}` placeholder the compiled `removeLabel` carries. */
export const REMOVE_LABEL_PLACEHOLDER = "{label}";

/** "Remove {label}" at "Vehicle 2" is "Remove Vehicle 2". */
export function removeLabelFor(template: string, instanceLabel: string): string {
  return template.replaceAll(REMOVE_LABEL_PLACEHOLDER, () => instanceLabel);
}

/**
 * The DOM id of a group's Add control: the focus destination after a removal that
 * emptied the group, when the button is the only candidate left on the page.
 *
 * It lives here rather than beside the component that renders it because a server
 * module needs it: the no-JS Server Action computes the focus destination, and a
 * `"use server"` module that reached for the component barrel would pull the React
 * renderer into the server graph, which Next refuses outright.
 */
export function addButtonId(groupId: string): string {
  return `qcms-repeat-add-${groupId}`;
}
