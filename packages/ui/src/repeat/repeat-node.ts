/**
 * React-free and dependency-free on purpose: a server-only BFF decoder imports the
 * `__qop` vocabulary from here, and a Server Component must not pull a client
 * component into its graph through a transitive import.
 */

/** The compiler's template node, carrying its member controls once. */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/** Produced at render time and never by the compiler, so stored bytes never carry one. */
export const REPEAT_INSTANCE_NODE_TYPE = "RepeatInstance";

/**
 * Spelled here rather than imported, because this package does not depend on the
 * kernel and the import-surface test keeps it that way. It and the kernel's
 * `ANSWER_KEY_SEPARATOR` are one contract, and a test asserts they agree.
 */
export const INSTANCE_NAME_SEPARATOR = "/";

/**
 * The reserved field name a roster operation posts under. A `<button name value>`
 * contributes its pair only when it is the submitter, which is what lets one step form
 * carry several operations with no scripting (ADR-43), so a whole-step POST carries at
 * most one entry.
 */
export const ROSTER_OP_FIELD = "__qop";

export const ROSTER_OPS = ["add", "remove"] as const;
export type RosterOp = (typeof ROSTER_OPS)[number];

/**
 * `token` is the one-time operation token the rendered page minted (ADR-43): the API
 * records it with the roster row, so a replayed post applies nothing. It is not a
 * credential, and refusing a replay is its only job.
 */
export interface RosterOpRequest {
  readonly op: RosterOp;
  readonly groupId: string;
  /** `remove` only. */
  readonly instanceId?: string;
  readonly token: string;
}

/** The `:`-joined button value, e.g. `remove:grp_x:ins_y:op_z`. */
export function rosterOpValue(request: RosterOpRequest): string {
  const parts: string[] =
    request.op === "remove"
      ? [request.op, request.groupId, request.instanceId ?? "", request.token]
      : [request.op, request.groupId, request.token];
  return parts.join(":");
}

/**
 * Total over hostile input: a respondent can type any bytes into the form, so anything
 * that is not exactly the shape {@link rosterOpValue} writes is refused. Only shape is
 * checked; whether a group or instance exists is the API's to decide.
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
 * The field's whole identity everywhere below the API (ADR-43), so every place that
 * keys on `name` keeps keying on one opaque string and never learns instances exist.
 */
export function qualifiedFieldName(instanceId: string, questionId: string): string {
  return `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`;
}

/** The live ordinal's placeholder in an instance-label template. */
export const INSTANCE_ORDINAL_PLACEHOLDER = "{n}";

/**
 * The ordinal is recomputed after a removal, so it is presentation and never identity
 * (ADR-42): the `ins_` id is what joins. A template with no `{n}` resolves to itself.
 *
 * The replacement is a function, because a replacement string expands `$&` and `$1`.
 */
export function instanceLabelFor(template: string, ordinal: number): string {
  const text = String(ordinal);
  return template.replaceAll(INSTANCE_ORDINAL_PLACEHOLDER, () => text);
}

/** The `{label}` placeholder the compiled `removeLabel` carries. */
export const REMOVE_LABEL_PLACEHOLDER = "{label}";

/** Puts the distinguishing words first, per APG's naming practice. */
export function removeLabelFor(template: string, instanceLabel: string): string {
  return template.replaceAll(REMOVE_LABEL_PLACEHOLDER, () => instanceLabel);
}

/**
 * The focus destination after a removal empties a group. It lives here rather than
 * beside the component because a `"use server"` module needs it, and reaching for the
 * component barrel would pull the React renderer into the server graph.
 */
export function addButtonId(groupId: string): string {
  return `qcms-repeat-add-${groupId}`;
}
