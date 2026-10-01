import {
  addButtonId,
  instanceLabelFor,
  INSTANCE_NAME_SEPARATOR,
} from "@roonga/qcms-ui/repeat-node";
import type { A2UIAnswerValue, A2UIStepDocument } from "@roonga/qcms-ui";

/**
 * What both portal paths need to know about a repeating group beyond what the renderer
 * draws: where focus lands after an operation, and what an instance is called (task
 * 073, ADR-42, ADR-43).
 *
 * It lives in its own module and not in either view because the two paths must answer
 * both questions identically. The scripted path moves focus itself and announces
 * through a `role="status"` region; the no-JS path expresses the same destination as an
 * `autofocus` attribute and announces nothing, because 4.1.3 scopes out a message
 * delivered by a change of context. One rule, two expressions.
 *
 * It decides nothing about the roster. Liveness is a function of the count source and
 * the API computes it above the evaluator (R2); what arrives here is the live list in
 * roster order.
 *
 * **Every value import here is from `@roonga/qcms-ui/repeat-node`, the React-free
 * subpath, and that is a boundary rather than a preference.** The no-JS Server Action
 * imports this module, and a `"use server"` module runs in the React Server Component
 * graph: reaching the component barrel from there pulls the whole renderer in and Next
 * refuses the build outright ("You're importing a module that depends on `useState`
 * into a React Server Component module"). The type import is erased and harmless.
 */

/**
 * Where focus lands after a removal (Q11, ruled 2026-09-29), in the ruled order: the
 * instance that took the removed one's place, else the previous instance when the
 * removed one was last, else the group's Add button when the removed one was the only
 * instance.
 *
 * `before` is roster order as the page the respondent pressed on rendered it, and that
 * is the only place the removed instance's position exists: the operation's own response
 * can report the order only after the removal. APG names the first destination in terms
 * for a destructive operation on a list, and its reasoning is the screen-reader one -
 * hearing the next item confirms the deletion and makes a second deletion efficient.
 * The second and third are this design's reading of that reasoning, since APG addresses
 * a scripted DOM removal and says nothing about the last-item or only-item cases; the
 * third can arise only in a group whose `min` is 0, because a group at `min: 1` has
 * nothing to empty.
 */
export function focusAfterRemoval(
  before: readonly string[],
  removed: string,
  groupId: string,
): string {
  const index = before.indexOf(removed);
  if (index < 0) return before[0] ?? addButtonId(groupId);
  const next = before[index + 1];
  if (next !== undefined) return next;
  const previous = before[index - 1];
  if (previous !== undefined) return previous;
  return addButtonId(groupId);
}

/** Where focus lands after an add: the instance the operation minted (Q11). */
export function focusAfterAdd(minted: readonly string[], groupId: string): string {
  // `minted` is the operation's own report of what it created, which is the only
  // trustworthy answer: a REPLAYED post minted nothing, because the one-time token had
  // already been spent, and the honest landing is then the group's Add button - the
  // instance the first post created is already on the page and focus has not moved since.
  // It replaced a diff of the rosters before and after, which gave the right answer only
  // when the read before the operation saw exactly the same set the operation did.
  return minted[0] ?? addButtonId(groupId);
}

/**
 * Each repeating group's instance-label template, read off the **stored** document's
 * `RepeatGroup` nodes: `grp_vehicles` to "Vehicle {n}".
 *
 * Read from the template rather than from an expanded tree so that a REMOVED instance
 * can still be named: the announcement says "Vehicle 2 removed", and by the time it is
 * composed that instance has no node left anywhere. The template plus the ordinal the
 * instance had in the roster before the removal is enough, and it is the same
 * substitution the renderer makes.
 */
export function instanceLabelTemplates(
  document: A2UIStepDocument | null,
): ReadonlyMap<string, string> {
  const templates = new Map<string, string>();
  if (document === null) return templates;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const props = record["props"];
    if (record["type"] === "RepeatGroup" && typeof props === "object" && props !== null) {
      const p = props as Record<string, unknown>;
      if (typeof p["groupId"] === "string" && typeof p["instanceLabel"] === "string") {
        templates.set(p["groupId"], p["instanceLabel"]);
      }
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(document.root);
  return templates;
}

/**
 * One instance's resolved label: "Vehicle 2", from the group's template and the
 * instance's one-based position in the roster it is being named against.
 *
 * `undefined` when the group or the instance is not in that roster, which a caller
 * turns into a sentence that names no instance rather than one naming the opaque id -
 * the `ins_` id is never something a respondent reads (ADR-42).
 */
export function resolvedInstanceLabel(
  templates: ReadonlyMap<string, string>,
  groupId: string,
  roster: readonly string[],
  instanceId: string,
): string | undefined {
  const template = templates.get(groupId);
  const index = roster.indexOf(instanceId);
  if (template === undefined || index < 0) return undefined;
  return instanceLabelFor(template, index + 1);
}

/**
 * What an Add or Remove hands back for the re-render of the step it posted from (task
 * 073, ADR-43).
 *
 * **It lives here rather than in the action's own module because a `"use server"` file
 * may export async functions and nothing else.** Next refuses the build otherwise - "A
 * `use server` file can only export async functions, found object" - and the refusal is
 * a 500 on the action's own POST rather than a build error, so it reads as a broken
 * mechanism rather than a misplaced export. The admin records the same rule for its own
 * actions (`apps/admin/README.md`, issue #256).
 */
export interface RosterActionState {
  /**
   * Every value the respondent had typed, keyed by the field's own name: a bare
   * questionId outside a repeating group and `instanceId/questionId` inside one.
   *
   * This is the carrier. It is the whole step rather than a refused subset, which is why
   * it rides the POST body and the action's own 200 rather than a cookie.
   */
  readonly values: Readonly<Record<string, A2UIAnswerValue>>;
  /**
   * The DOM id this render lands focus on, which becomes an `autofocus` attribute (Q11,
   * and the 2026-10-01 ruling that it is `autofocus` and never a fragment).
   */
  readonly autofocusId?: string;
  /** A sentence to show when the operation was refused. */
  readonly message?: string;
}

/** Nothing typed, nothing landed: the state before the respondent presses anything. */
export const NO_ROSTER_ACTION: RosterActionState = { values: {} };

/**
 * The session the form belongs to, posted as a hidden input by the step renderer (task
 * 073). It is a fifth reserved name beside `__qop`, `__qk__`, `__qa__` and the honeypot's
 * `website`.
 *
 * It exists so the `__qop` Server Action can be a **stable module-level reference**. The
 * obvious alternative is `rosterOperation.bind(null, sessionId)`, and handing that to
 * `useActionState` hangs the server render outright: Next compares a bound reference's
 * signature asynchronously, the comparison never settles inside a render, the POST never
 * gets a response, and the dev server dies with `RangeError: Map maximum size exceeded`
 * after accumulating promises. A hidden input is how plain HTML has always given one form
 * its context.
 *
 * **It is a label, not a credential.** The authority is the session bearer in the
 * httpOnly cookie, which the API checks against the session the path names; a post naming
 * another session with this token is refused by the API, not here (R2: the portal
 * validates nothing).
 */
export const SESSION_FIELD = "__qsid";

/**
 * Split a rendered field name into the pair the API takes: the question, and the
 * instance when the field is inside a repeating group (task 073, Q15).
 *
 * The qualified name `instanceId/questionId` is the field's whole identity everywhere
 * ABOVE the API: the renderer names its inputs with it, the decoder reads it back, the
 * error summary anchors to it, and the step's values are keyed by it. The API takes the
 * two parts separately, so this is the one place the name is taken apart, and every
 * caller that posts an answer goes through it. A field outside a group has no separator
 * and yields the bare question.
 */
export function splitFieldKey(field: string): { questionId: string; instanceId?: string } {
  const cut = field.indexOf(INSTANCE_NAME_SEPARATOR);
  if (cut < 0) return { questionId: field };
  return { instanceId: field.slice(0, cut), questionId: field.slice(cut + 1) };
}
