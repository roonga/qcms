import type { A2Node } from "@a2ra/core";

import {
  INSTANCE_ORDINAL_PLACEHOLDER,
  REPEAT_GROUP_NODE_TYPE,
  REPEAT_INSTANCE_NODE_TYPE,
  instanceLabelFor,
  removeLabelFor,
} from "./repeat-node.ts";
import { repeatTableNode, type RepeatTableInput } from "./repeat-table-expand.ts";
import { REPEAT_TABLE_NODE_TYPE } from "./repeat-table-node.ts";
import {
  childArray,
  keepControl,
  mapChildren,
  numberProp,
  qualifyNames,
  stringProp,
} from "./repeat-walk.ts";

/**
 * The compiler is answer-blind (ADR-14) and an instance count is answer-dependent, so it emits a template and
 * this clones it per live instance with qualified names; the roster comes from the API (R2). Visibility is
 * pruned per instance here, since the API's visible set holds qualified names. The honeypot is never cloned:
 * a decoy in the template would post one `website` field per instance.
 */

/** What the renderer knows at render time that the stored document cannot. */
export interface RepeatExpansion {
  /**
   * Already derived and truncated by the API (ADR-42: evaluator and renderer both see
   * the live set, never the event record). A group with no entry renders no instance.
   */
  readonly rosters?: Readonly<Record<string, readonly string[]>>;
  /** Qualified names. Absent prunes nothing, which an admin preview wants. */
  readonly visible?: ReadonlySet<string>;
  /** The one-time token this render mints into its `__qop` button values. */
  readonly opToken?: string;
  /**
   * Set when a `perInstanceStep` group paginates the step (ADR-28 as amended). It
   * narrows a roster the host already holds in full and is never a visibility
   * decision, which is why the full roster still names an instance and decides whether
   * the Add control belongs on this page.
   */
  readonly view?: {
    readonly groupId: string;
    readonly instanceId: string;
  };
}

// The levels for the document as the page: the compiled outline puts the form title at
// `h1` and the step title at `h2`. An embedded document is renumbered afterwards by
// `withDemotedHeadings`, so the offset is applied in exactly one place.
const GROUP_HEADING_LEVEL = "h3" as const;
const INSTANCE_HEADING_LEVEL = "h4" as const;

type HeadingLevel = typeof GROUP_HEADING_LEVEL | typeof INSTANCE_HEADING_LEVEL;

// Takes the same input shape the table presentation does, so the two layouts are two
// readings of one set of facts rather than two sets that happen to agree.
function stackedChildren(input: RepeatTableInput, drawnOnly?: string): A2Node[] {
  const children: A2Node[] = [];
  if (input.label !== "") children.push(groupHeading(input.label, GROUP_HEADING_LEVEL));
  input.instances.forEach((instanceId, index) => {
    // The loop runs over the full roster even when a view draws one instance, so the
    // ordinal is the instance's place in the group rather than in the drawn subset.
    if (drawnOnly !== undefined && instanceId !== drawnOnly) return;
    const resolved = instanceLabelFor(input.instanceLabelTemplate, index + 1);
    const instanceProps: Record<string, unknown> = {
      groupId: input.groupId,
      instanceId,
      label: resolved,
      ordinal: index + 1,
      headingAs: INSTANCE_HEADING_LEVEL,
    };
    if (input.removable && input.removeLabelTemplate !== undefined) {
      instanceProps.removeLabel = removeLabelFor(input.removeLabelTemplate, resolved);
    }
    if (input.removable && input.opToken !== undefined) instanceProps.opToken = input.opToken;
    children.push({
      type: REPEAT_INSTANCE_NODE_TYPE,
      props: instanceProps,
      children: input.template
        .filter((control) => keepControl(control, instanceId, input.visible))
        .map((control) => qualifyNames(control, instanceId)),
    });
  });
  return children;
}

function groupHeading(label: string, as: HeadingLevel): A2Node {
  return { type: "Text", props: { as, size: "lg", weight: "semibold" }, children: label };
}

function expandGroup(node: A2Node, expansion: RepeatExpansion): A2Node {
  const groupId = stringProp(node, "groupId");
  const instanceLabelTemplate = stringProp(node, "instanceLabel") ?? INSTANCE_ORDINAL_PLACEHOLDER;
  const label = stringProp(node, "label") ?? "";
  const countSource = stringProp(node, "countSource");
  const removeLabelTemplate = stringProp(node, "removeLabel");
  const max = numberProp(node, "max");
  const min = numberProp(node, "min") ?? 0;
  // Not a shape the compiler can emit; an empty group keeps this function total.
  const instances = groupId === undefined ? [] : (expansion.rosters?.[groupId] ?? []);
  const template = childArray(node.children);

  const drawnOnly =
    groupId !== undefined && expansion.view?.groupId === groupId
      ? expansion.view.instanceId
      : undefined;
  // The last view is the one page where offering another instance does not reorder the
  // pages ahead of the respondent.
  const onLastView = drawnOnly === undefined || drawnOnly === instances[instances.length - 1];

  // A `fixed` group's size is its author's and a `fromAnswer` group's is the count
  // answer's, so a post naming either is drift and the API refuses it.
  const addable = countSource === "open";
  // Against the full roster, never the drawn subset: a group at `max` must not offer an
  // enabled Add merely because this page shows one of its instances.
  const canAdd = addable && (max === undefined || instances.length < max);
  // Going below `min` is a submit-time refusal (ADR-42), so a respondent can empty a
  // group and rebuild it, and is only stopped at the end.
  const removable = addable;
  const presentation = stringProp(node, "presentation") ?? "stacked";

  // The conditional spreads are what `exactOptionalPropertyTypes` asks for: an absent
  // key and a key holding `undefined` differ to a node prop a `.strict()` schema parses.
  const input: RepeatTableInput = {
    groupId: groupId ?? "",
    label,
    instanceLabelTemplate,
    removable,
    instances,
    template,
    ...(removeLabelTemplate === undefined ? {} : { removeLabelTemplate }),
    ...(expansion.visible === undefined ? {} : { visible: expansion.visible }),
    ...(expansion.opToken === undefined ? {} : { opToken: expansion.opToken }),
  };
  const children: A2Node[] =
    presentation === "table" ? [repeatTableNode(input)] : stackedChildren(input, drawnOnly);

  const props: Record<string, unknown> = {
    groupId: groupId ?? "",
    label,
    instanceLabel: instanceLabelTemplate,
    presentation: stringProp(node, "presentation") ?? "stacked",
    countSource: countSource ?? "open",
    min,
    instanceCount: instances.length,
    canAdd,
  };
  if (max !== undefined) props.max = max;
  const addLabel = stringProp(node, "addLabel");
  // Omitting the label withholds the control, so a page that is not the last view
  // carries no Add markup rather than a disabled button, which would read as "at
  // maximum" to a respondent who is neither.
  if (addLabel !== undefined && onLastView) props.addLabel = addLabel;
  if (removeLabelTemplate !== undefined) props.removeLabel = removeLabelTemplate;
  if (expansion.opToken !== undefined) props.opToken = expansion.opToken;
  return { type: REPEAT_GROUP_NODE_TYPE, props, children };
}

function isExpanded(node: A2Node): boolean {
  return childArray(node.children).some(
    (child) => child.type === REPEAT_INSTANCE_NODE_TYPE || child.type === REPEAT_TABLE_NODE_TYPE,
  );
}

/**
 * A host may expand before pruning, and the hydrated portal does, since the commit-moment walk and the error
 * summary need the whole document. It compares the name as it stands, unlike {@link keepControl}, because
 * expanded controls carry qualified names. Unchanged referentially when nothing is pruned.
 */
function pruneExpanded(node: A2Node, visible: ReadonlySet<string>): A2Node {
  let pruned = false;
  const children = childArray(node.children);
  const next = children.map((child) => {
    if (child.type !== REPEAT_INSTANCE_NODE_TYPE) return child;
    const controls = childArray(child.children);
    const kept = controls.filter((control) => {
      const name = stringProp(control, "name");
      // No name of its own means structure rather than a field.
      return name === undefined || visible.has(name);
    });
    if (kept.length === controls.length) return child;
    pruned = true;
    return { ...child, children: kept };
  });
  return pruned ? { ...node, children: next } : node;
}

/**
 * A render-time copy of `root` with every `RepeatGroup` template expanded per live
 * instance. Idempotent, so a host that expanded before pruning and a renderer that
 * expands defensively cannot double-expand; such a group is still pruned against
 * `visible`. Returns `root` itself when nothing changed.
 */
export function expandRepeatGroups(root: A2Node, expansion: RepeatExpansion = {}): A2Node {
  let touched = false;
  const walk = (node: A2Node): A2Node => {
    if (node.type === REPEAT_GROUP_NODE_TYPE) {
      if (!isExpanded(node)) {
        touched = true;
        return expandGroup(node, expansion);
      }
      // Expanded already, so the visible set has to be applied here or nowhere.
      if (expansion.visible === undefined) return node;
      const narrowed = pruneExpanded(node, expansion.visible);
      if (narrowed !== node) touched = true;
      return narrowed;
    }
    const children = node.children;
    if (children === undefined || typeof children === "string") return node;
    return { ...node, children: mapChildren(children, walk) };
  };
  const next = walk(root);
  return touched ? next : root;
}

/** The cheap guard a caller uses before asking for an expansion. */
export function hasRepeatGroup(root: A2Node): boolean {
  if (root.type === REPEAT_GROUP_NODE_TYPE) return true;
  return childArray(root.children).some((child) => hasRepeatGroup(child));
}
