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
 * Render-time expansion of a `RepeatGroup` template (ADR-42, ADR-43).
 *
 * The compiler is pure and answer-blind (ADR-14) and an instance count is
 * answer-dependent, so it emits a template carrying the member controls once with the
 * bare `questionId` as each `name`, and this clones it per live instance, in roster
 * order, rewriting each clone's `name` to `ins_7k2/q_passport`. The stored bytes are
 * never touched (ADR-18), and the roster reaches the renderer from the API's step
 * projection because the API is the only rule evaluator (R2).
 *
 * Per-instance visibility is pruned here, which is why `documentForVisible` leaves a
 * template alone: a rule inside a group is evaluated once per live instance, so the
 * API's visible set holds qualified names and a bare template name can never be in
 * it.
 *
 * The honeypot is never cloned: the compiler appends the ADR-12 decoy to the step's
 * `Flex` after the group node, so it is outside the template by construction and a
 * decoy inside one would post a `website` field per instance.
 */

/** What the renderer knows at render time that the stored document cannot. */
export interface RepeatExpansion {
  /**
   * The live roster per group, in roster order, already derived and truncated by the
   * API (ADR-42: both the evaluator and the renderer receive the live set, never the
   * event record). A group with no entry renders no instance.
   */
  readonly rosters?: Readonly<Record<string, readonly string[]>>;
  /**
   * The visible field names, qualified. When given, a member control is dropped from
   * an instance whose qualified name is not in it. When absent nothing is pruned,
   * which is what an admin preview with no flow projection wants.
   */
  readonly visible?: ReadonlySet<string>;
  /** The one-time operation token this render mints into its `__qop` button values. */
  readonly opToken?: string;
  /**
   * The step view this render draws, when a `perInstanceStep` group paginates the step
   * into one page per live instance (ADR-28 as amended).
   *
   * The group named here draws exactly the instance named here, and every other group
   * on the step is untouched. The kernel picked the view, so this prop carries that
   * decision rather than repeating it, and nothing here is a visibility decision: it
   * narrows a roster the host already holds in full, which is why the full roster
   * still names an instance and decides whether the Add control belongs on this page.
   */
  readonly view?: {
    readonly groupId: string;
    readonly instanceId: string;
  };
}

/**
 * The heading levels a group emits, against the compiled outline: the form title is
 * `h1` and the step title `h2`, so a group's own label is `h3` and an instance's `h4`.
 *
 * These are the levels for the document as the page. An embedded document is
 * renumbered by `withDemotedHeadings`, which runs after this transform and moves
 * both, so the offset is applied in exactly one place.
 */
const GROUP_HEADING_LEVEL = "h3" as const;
const INSTANCE_HEADING_LEVEL = "h4" as const;

type HeadingLevel = typeof GROUP_HEADING_LEVEL | typeof INSTANCE_HEADING_LEVEL;

/**
 * The stacked presentation's children: the group's own heading followed by one
 * `RepeatInstance` per live instance. It takes the same input shape the table
 * presentation does, so the two layouts are two readings of one set of facts rather
 * than two sets that happen to agree.
 */
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

/** A `Text` heading node carrying the group's own authored label. */
function groupHeading(label: string, as: HeadingLevel): A2Node {
  return { type: "Text", props: { as, size: "lg", weight: "semibold" }, children: label };
}

/**
 * Expand one template node into the group node the registry renders: the same
 * `RepeatGroup` type, carrying its render-time facts, whose children are the group's
 * heading followed by one `RepeatInstance` per live instance.
 */
function expandGroup(node: A2Node, expansion: RepeatExpansion): A2Node {
  const groupId = stringProp(node, "groupId");
  const instanceLabelTemplate = stringProp(node, "instanceLabel") ?? INSTANCE_ORDINAL_PLACEHOLDER;
  const label = stringProp(node, "label") ?? "";
  const countSource = stringProp(node, "countSource");
  const removeLabelTemplate = stringProp(node, "removeLabel");
  const max = numberProp(node, "max");
  const min = numberProp(node, "min") ?? 0;
  // A group with no id is not a shape the compiler can emit; an empty group is the
  // honest degradation and keeps this function total.
  const instances = groupId === undefined ? [] : (expansion.rosters?.[groupId] ?? []);
  const template = childArray(node.children);

  // The one instance this page draws, when this group paginates the step; `undefined`
  // otherwise, and then every live instance is drawn.
  const drawnOnly =
    groupId !== undefined && expansion.view?.groupId === groupId
      ? expansion.view.instanceId
      : undefined;
  // The Add control is on the last view and nowhere earlier: a paginated open-ended
  // group has to stay growable, and the end of the walk is the one page where offering
  // another instance does not reorder the pages ahead of the respondent. Counted
  // against the full roster, because the drawn instance is one of many.
  const onLastView = drawnOnly === undefined || drawnOnly === instances[instances.length - 1];

  // Add and Remove exist on an `open` group alone: a `fixed` group's size is its
  // author's and a `fromAnswer` group's is the count answer's, so a post naming either
  // is drift and the API refuses it.
  const addable = countSource === "open";
  // Against the full roster, never the drawn subset: a group at `max` must not offer an
  // enabled Add merely because this page shows one of its instances.
  const canAdd = addable && (max === undefined || instances.length < max);
  // Nothing here refuses a removal that would take the group below `min`: that is a
  // submit-time refusal (ADR-42), so a respondent can empty a group, rebuild it, and
  // only be stopped at the end.
  const removable = addable;
  const presentation = stringProp(node, "presentation") ?? "stacked";

  // The table presentation uses a `<caption>` rather than a heading node, so the
  // group's own label is said once. Everything outside those children is the same
  // chrome the stacked presentation gets, since none of it is about the layout. The
  // conditional spreads are what `exactOptionalPropertyTypes` asks for: an absent key
  // and a key holding `undefined` differ to a node prop a `.strict()` schema parses.
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
  // Omitting the label is how the Add control is withheld, rather than a second flag,
  // so a page that is not the last view carries no Add markup at all rather than a
  // disabled button, which would read as "at maximum" to a respondent who is neither.
  if (addLabel !== undefined && onLastView) props.addLabel = addLabel;
  if (removeLabelTemplate !== undefined) props.removeLabel = removeLabelTemplate;
  if (expansion.opToken !== undefined) props.opToken = expansion.opToken;
  return { type: REPEAT_GROUP_NODE_TYPE, props, children };
}

/** Whether this node has already been expanded. */
function isExpanded(node: A2Node): boolean {
  return childArray(node.children).some(
    (child) => child.type === REPEAT_INSTANCE_NODE_TYPE || child.type === REPEAT_TABLE_NODE_TYPE,
  );
}

/**
 * Prune an already expanded group's instances against the visible set.
 *
 * A host may expand before pruning, and the hydrated portal does, because it hands the
 * same expanded tree to the commit-moment walk and the error summary, which both need
 * the whole document. Pruning therefore has to happen on the way into the renderer:
 * `documentForVisible` skips a `RepeatGroup` subtree by design, since it cannot tell a
 * template's bare member names from an instance's qualified ones.
 *
 * It compares the name as it stands, because an expanded instance's controls already
 * carry qualified names, which is exactly what the visible set holds. That is the one
 * difference from {@link keepControl}, which runs on a template whose names are bare.
 *
 * Returns the node referentially unchanged when nothing is pruned, so `useMemo`
 * downstream still sees the tree it saw before.
 */
function pruneExpanded(node: A2Node, visible: ReadonlySet<string>): A2Node {
  let pruned = false;
  const children = childArray(node.children);
  const next = children.map((child) => {
    if (child.type !== REPEAT_INSTANCE_NODE_TYPE) return child;
    const controls = childArray(child.children);
    const kept = controls.filter((control) => {
      const name = stringProp(control, "name");
      // A node with no name of its own is structure rather than a field, so it is
      // never pruned by name.
      return name === undefined || visible.has(name);
    });
    if (kept.length === controls.length) return child;
    pruned = true;
    return { ...child, children: kept };
  });
  return pruned ? { ...node, children: next } : node;
}

/**
 * Return a render-time copy of `root` whose every `RepeatGroup` template is expanded
 * into one `RepeatInstance` per live instance.
 *
 * Idempotent: a group whose children are already instances is never expanded a second
 * time, so a host that expanded before pruning and a renderer that expands defensively
 * cannot double-expand. Such a group is still pruned against `visible`, because that
 * is the only place a host which expanded first can have it done. A document with no
 * group, and a group with nothing to prune, come back referentially unchanged, so
 * `useMemo` downstream sees the node it saw before.
 */
export function expandRepeatGroups(root: A2Node, expansion: RepeatExpansion = {}): A2Node {
  let touched = false;
  const walk = (node: A2Node): A2Node => {
    if (node.type === REPEAT_GROUP_NODE_TYPE) {
      if (!isExpanded(node)) {
        touched = true;
        return expandGroup(node, expansion);
      }
      // Already expanded, by a host that expanded before pruning: no instance is
      // cloned twice, but the visible set has to be applied here or nowhere.
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

/** Whether a node tree carries a `RepeatGroup` at all: the cheap guard for callers. */
export function hasRepeatGroup(root: A2Node): boolean {
  if (root.type === REPEAT_GROUP_NODE_TYPE) return true;
  return childArray(root.children).some((child) => hasRepeatGroup(child));
}
