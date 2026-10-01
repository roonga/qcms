import { addButtonId, instanceLabelFor } from "@roonga/qcms-ui/repeat-node";
import type { A2UIStepDocument } from "@roonga/qcms-ui";

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
export function focusAfterAdd(
  before: readonly string[],
  after: readonly string[],
  groupId: string,
): string {
  return after.find((id) => !before.includes(id)) ?? addButtonId(groupId);
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
