import {
  addButtonId,
  instanceLabelFor,
  INSTANCE_NAME_SEPARATOR,
} from "@roonga/qcms-ui/repeat-node";
import type { A2UIAnswerValue, A2UIStepDocument } from "@roonga/qcms-ui";

/**
 * What both portal paths need to know about a repeating group beyond what the renderer
 * draws (ADR-42, ADR-43). Its own module because the two paths have to answer
 * identically: one moves focus itself, the other expresses the same destination as an
 * `autofocus` attribute.
 *
 * Every value import is from `@roonga/qcms-ui/repeat-node`, the React-free subpath, and
 * that is a boundary rather than a preference: the no-JS Server Action imports this
 * module, and reaching the component barrel from a `"use server"` module pulls the whole
 * renderer into the server graph and Next refuses the build.
 */

/**
 * Q11's ruled order: the instance that took the removed one's place, else the previous
 * instance, else the group's Add button.
 *
 * `before` is roster order as the page the respondent pressed on rendered it, which is
 * the only place the removed instance's position exists. The first destination is APG's
 * for a destructive operation on a list; the others are this design's reading of the
 * same reasoning, since APG says nothing about the last-item or only-item cases.
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

/**
 * `minted` is the operation's own report of what it created, which is the only
 * trustworthy answer: a replayed post minted nothing, the one-time token having been
 * spent, and the honest landing is then the group's Add button.
 *
 * A `paginated` group has no destination at all: the new instance is a view one page
 * further along, so neither its heading nor the Add button is in this document, and only
 * Continue, Back and Submit may move the rendered page (ADR-28).
 */
export function focusAfterAdd(
  minted: readonly string[],
  groupId: string,
  paginated = false,
): string | undefined {
  if (paginated) return undefined;
  return minted[0] ?? addButtonId(groupId);
}

/**
 * Read from the stored document's templates rather than from an expanded tree so a
 * removed instance can still be named: by the time its announcement is composed it has
 * no node left anywhere, and the template plus its pre-removal ordinal is enough.
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
 * `undefined` when the group or the instance is not in that roster, which a caller turns
 * into a sentence naming no instance rather than one naming the `ins_` id, which is
 * never something a respondent reads (ADR-42).
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
 * Maps the API's projection pair onto the renderer's own `view` option, which is the one
 * place a narrowing is expressed, so the two portal paths cannot narrow differently. It
 * decides nothing: the cursor and the view list are the API's (R2).
 */
export function viewNarrowing(view: {
  readonly groupId: string | null;
  readonly instanceId: string | null;
}): { readonly groupId: string; readonly instanceId: string } | undefined {
  const { groupId, instanceId } = view;
  if (groupId === null || instanceId === null) return undefined;
  return { groupId, instanceId };
}

/**
 * The page chrome needs this because the progress indicator counts views, so without the
 * instance's name a paginated group's pages are indistinguishable from ordinary steps.
 *
 * Resolved against the full roster, so the ordinal is the instance's place in the group
 * rather than in a one-element list.
 */
export function viewInstanceLabel(
  templates: ReadonlyMap<string, string>,
  rosters: Readonly<Record<string, readonly string[]>>,
  view: { readonly groupId: string | null; readonly instanceId: string | null },
): string | undefined {
  const narrowed = viewNarrowing(view);
  if (narrowed === undefined) return undefined;
  return resolvedInstanceLabel(
    templates,
    narrowed.groupId,
    rosters[narrowed.groupId] ?? [],
    narrowed.instanceId,
  );
}

/**
 * What an Add or Remove hands back for the re-render of the step it posted from.
 *
 * It lives here rather than in the action's own module because a `"use server"` file may
 * export async functions and nothing else, and Next's refusal is a 500 on the action's
 * own POST rather than a build error.
 */
export interface RosterActionState {
  /**
   * The carrier: the whole step rather than a refused subset, which is why it rides the
   * POST body and the action's own 200 rather than a cookie.
   */
  readonly values: Readonly<Record<string, A2UIAnswerValue>>;
  /** Becomes an `autofocus` attribute, never a fragment (Q11). */
  readonly autofocusId?: string;
  readonly message?: string;
}

export const NO_ROSTER_ACTION: RosterActionState = { values: {} };

/**
 * A fifth reserved field name, which exists so the `__qop` Server Action can be a stable
 * module-level reference: `rosterOperation.bind(null, sessionId)` handed to
 * `useActionState` hangs the server render, because Next compares a bound reference's
 * signature asynchronously and that never settles inside a render.
 *
 * It is a label, not a credential. The authority is the session bearer in the httpOnly
 * cookie, and a post naming another session is refused by the API, not here (R2).
 */
export const SESSION_FIELD = "__qsid";

/**
 * The qualified name is the field's whole identity above the API, which takes the two
 * parts separately, so this is the one place the name is taken apart and every caller
 * that posts an answer goes through it (Q15).
 */
export function splitFieldKey(field: string): { questionId: string; instanceId?: string } {
  const cut = field.indexOf(INSTANCE_NAME_SEPARATOR);
  if (cut < 0) return { questionId: field };
  return { instanceId: field.slice(0, cut), questionId: field.slice(cut + 1) };
}
