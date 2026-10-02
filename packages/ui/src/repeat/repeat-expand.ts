import type { A2Node } from "@a2ra/core";

import {
  INSTANCE_ORDINAL_PLACEHOLDER,
  REPEAT_GROUP_NODE_TYPE,
  REPEAT_INSTANCE_NODE_TYPE,
  instanceLabelFor,
  qualifiedFieldName,
  removeLabelFor,
} from "./repeat-node.ts";

/**
 * Render-time expansion of a `RepeatGroup` template (task 073, ADR-42, ADR-43).
 *
 * ## Why the renderer and not the compiler
 *
 * `compileFormWith` is pure and answer-blind - `StepResolverContext` carries the
 * snapshot, the locale and the resolvers and nothing else (ADR-14, whose 2026-09-30
 * amendment says repetition does **not** widen it) - and an instance count is
 * answer-dependent. So the compiler emits a template carrying the member controls
 * **once** with the bare `questionId` as each `name`, and this function clones it per
 * **live instance**, in roster order, rewriting each clone's `name` to
 * `ins_7k2/q_passport`.
 *
 * The stored bytes are never touched, which keeps ADR-18 exact: the expansion is a
 * render-time transform on the precedent `withNativeSubmit` and `withDemotedHeadings`
 * already set, and the roster it works from reaches the renderer from the API's step
 * projection because the API is the only rule evaluator (R2).
 *
 * ## Per-instance visibility is pruned HERE, and that is the whole reason
 * `documentForVisible` leaves a template alone
 *
 * A rule whose target is inside a group is evaluated **once per live instance**, so a
 * member question can be visible in instance 1 and hidden in instance 2. The visible
 * set the API sends is therefore a set of **qualified** names, and a bare template
 * name can never be in it. `documentForVisible` consequently skips a `RepeatGroup`
 * subtree (it would otherwise prune every member control away), and this function
 * prunes each clone against the same set.
 *
 * ## The honeypot is never cloned
 *
 * The compiler appends the ADR-12 decoy to the step's `Flex` **after** the group
 * node, so it is outside the template by construction and a ten-instance step carries
 * exactly one. A decoy inside the template would post ten `website` fields.
 */

/** What the renderer knows at render time that the stored document cannot. */
export interface RepeatExpansion {
  /**
   * The live roster per group, in roster order, already derived and truncated by the
   * API (ADR-42: the evaluator and the renderer both receive the live set, never the
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
   * The **step view** this render draws, when a `perInstanceStep` group paginates the
   * step into one page per live instance (task 076, ADR-28 as amended 2026-09-29).
   *
   * The group named here draws exactly the one instance named here, and every other
   * group on the step is untouched - a step may hold a paginating group beside a
   * stacked one, and only the first `perInstanceStep` group paginates it (the kernel's
   * `stepViews` picks it, and this prop carries that decision rather than repeating it).
   *
   * **Nothing here is a visibility decision.** The API computed the view list and told
   * the host which view to draw; this is the render-time narrowing of a roster the host
   * was already handed in full, which is why the full roster is still what names an
   * instance ("Vehicle 2" keeps its ordinal on its own page) and what decides whether
   * the Add control belongs on this page.
   *
   * Absent for every other render, including every stacked group, so a document with no
   * paginating group expands byte-identically to before.
   */
  readonly view?: {
    readonly groupId: string;
    readonly instanceId: string;
  };
}

/**
 * The two heading levels a group emits, against the compiled outline: the form title
 * is `h1` (first step only) and the step title is `h2`, so the group's own label is
 * `h3` and an instance's is `h4`.
 *
 * **These are the levels for the document as the page**, which is the portal. An
 * embedded document is renumbered by `withDemotedHeadings`, which runs after this
 * transform and moves both - the group's label because it is an ordinary `Text`
 * heading node, and the instance's because that transform carries one extra rule for
 * `RepeatInstance.headingAs`. So the offset is applied in exactly one place and
 * cannot be applied twice.
 */
const GROUP_HEADING_LEVEL = "h3" as const;
const INSTANCE_HEADING_LEVEL = "h4" as const;

type HeadingLevel = typeof GROUP_HEADING_LEVEL | typeof INSTANCE_HEADING_LEVEL;

/**
 * Map a node's `children` union. A text body and an absent body are returned as they
 * are; a single child is mapped; an array is mapped elementwise.
 *
 * Split in two, exactly as `heading-demotion.ts` splits the same walk, so each
 * function has one declared result type: a single conditional chain over this union
 * is the shape the lint refuses, and for a good reason - it is the place a mapped
 * text body would silently become a node.
 */
function mapNodeChildren(
  children: A2Node | A2Node[],
  map: (child: A2Node) => A2Node,
): A2Node | A2Node[] {
  return Array.isArray(children) ? children.map(map) : map(children);
}

function mapChildren(
  children: A2Node["children"],
  map: (child: A2Node) => A2Node,
): A2Node["children"] {
  const isNodes = children !== undefined && typeof children !== "string";
  return isNodes ? mapNodeChildren(children, map) : children;
}

function childArray(children: A2Node["children"]): readonly A2Node[] {
  if (children === undefined || typeof children === "string") return [];
  return Array.isArray(children) ? children : [children];
}

function stringProp(node: A2Node, key: string): string | undefined {
  const value: unknown = node.props?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberProp(node: A2Node, key: string): number | undefined {
  const value: unknown = node.props?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Rewrite one member control's `name` to its qualified form, recursively, so a
 * control whose own children carry no name (a `RadioGroup`'s `Radio` leaves, a
 * `CheckboxGroup`'s `Checkbox` leaves) is copied unchanged beneath it.
 *
 * Only the `name` prop moves. Every other compiled prop - `label`, `description`,
 * `isRequired`, the constraint hints, the author's `messages` - is the stored
 * content and is carried across untouched, which is what makes an instance's control
 * identical to the same question outside a group (ADR-42: a question does not know
 * that it is repeated).
 */
function qualifyNames(node: A2Node, instanceId: string): A2Node {
  const mapped = mapChildren(node.children, (child) => qualifyNames(child, instanceId));
  const name = stringProp(node, "name");
  if (name === undefined) return { ...node, children: mapped };
  return {
    ...node,
    props: { ...node.props, name: qualifiedFieldName(instanceId, name) },
    children: mapped,
  };
}

/** Whether a cloned control survives this instance's visible set. */
function keepControl(node: A2Node, instanceId: string, visible?: ReadonlySet<string>): boolean {
  if (visible === undefined) return true;
  const name = stringProp(node, "name");
  if (name === undefined) return true;
  return visible.has(qualifiedFieldName(instanceId, name));
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
  // A group with no id is not a shape the compiler can emit; rendering it as an empty
  // group is the honest degradation and keeps this function total.
  const instances = groupId === undefined ? [] : (expansion.rosters?.[groupId] ?? []);
  const template = childArray(node.children);

  // The one instance this page draws, when this group is what paginates the step (task
  // 076). `undefined` for every other render, and then every live instance is drawn, so
  // the stacked presentation is unchanged.
  const drawnOnly =
    groupId !== undefined && expansion.view?.groupId === groupId
      ? expansion.view.instanceId
      : undefined;
  // **The Add control is on the LAST view and nowhere earlier** (task 076, ADR-28's
  // 2026-08-31 amendment read forward onto the views): an open-ended group paginated
  // into pages has to stay growable, and the end of the walk is the one page where
  // offering another instance does not reorder the pages ahead of the respondent.
  // Counted against the FULL roster, because the drawn instance is one of many.
  const onLastView = drawnOnly === undefined || drawnOnly === instances[instances.length - 1];

  // Add and Remove exist on an `open` group alone: a `fixed` group's size is its
  // author's and a `fromAnswer` group's is the count answer's, so a post naming
  // either is drift and the API refuses it (`REPEAT_NOT_ADDABLE`).
  const addable = countSource === "open";
  // Against the full roster, never the drawn subset: a group at `max` must not offer an
  // enabled Add merely because this page shows one of its instances.
  const canAdd = addable && (max === undefined || instances.length < max);
  // Nothing here refuses a removal that would take the group below `min`: that is a
  // submit-time refusal (`REPEAT_COUNT_OUT_OF_RANGE`, ADR-42), so a respondent can
  // empty a group, rebuild it, and only be stopped at the end. The control is offered
  // whenever the source is `open`.
  const removable = addable;

  const children: A2Node[] = [];
  if (label !== "") children.push(groupHeading(label, GROUP_HEADING_LEVEL));
  instances.forEach((instanceId, index) => {
    // The ordinal is the instance's place in the FULL roster, so "Vehicle 2" is still
    // Vehicle 2 on its own page rather than Vehicle 1 of a one-element list.
    if (drawnOnly !== undefined && instanceId !== drawnOnly) return;
    const resolved = instanceLabelFor(instanceLabelTemplate, index + 1);
    const instanceProps: Record<string, unknown> = {
      groupId: groupId ?? "",
      instanceId,
      label: resolved,
      ordinal: index + 1,
      headingAs: INSTANCE_HEADING_LEVEL,
    };
    if (removable && removeLabelTemplate !== undefined) {
      instanceProps.removeLabel = removeLabelFor(removeLabelTemplate, resolved);
    }
    if (removable && expansion.opToken !== undefined) instanceProps.opToken = expansion.opToken;
    children.push({
      type: REPEAT_INSTANCE_NODE_TYPE,
      props: instanceProps,
      children: template
        .filter((control) => keepControl(control, instanceId, expansion.visible))
        .map((control) => qualifyNames(control, instanceId)),
    });
  });

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
  // Omitting the label is how the Add control is withheld, rather than a second flag:
  // `RepeatGroup` renders the control only for a labelled, `open` group, so a page that
  // is not the last view of a paginated group carries no Add markup at all - not a
  // disabled button, which would read as "at maximum" to a respondent who is neither.
  if (addLabel !== undefined && onLastView) props.addLabel = addLabel;
  if (removeLabelTemplate !== undefined) props.removeLabel = removeLabelTemplate;
  if (expansion.opToken !== undefined) props.opToken = expansion.opToken;
  return { type: REPEAT_GROUP_NODE_TYPE, props, children };
}

/** Whether this node has already been expanded (its children are instances). */
function isExpanded(node: A2Node): boolean {
  return childArray(node.children).some((child) => child.type === REPEAT_INSTANCE_NODE_TYPE);
}

/**
 * Return a render-time copy of `root` whose every `RepeatGroup` template is expanded
 * into one `RepeatInstance` per live instance.
 *
 * **Idempotent**: a group whose children are already instances is returned as it is,
 * so a host that expanded before pruning and a renderer that expands defensively
 * cannot double-expand. A document with no group is returned **referentially
 * unchanged**, so every existing render is byte-identical and `useMemo` downstream
 * sees the same node it saw before.
 */
export function expandRepeatGroups(root: A2Node, expansion: RepeatExpansion = {}): A2Node {
  let touched = false;
  const walk = (node: A2Node): A2Node => {
    if (node.type === REPEAT_GROUP_NODE_TYPE && !isExpanded(node)) {
      touched = true;
      return expandGroup(node, expansion);
    }
    const children = node.children;
    if (children === undefined || typeof children === "string") return node;
    return { ...node, children: mapChildren(children, walk) };
  };
  const next = walk(root);
  return touched ? next : root;
}

/** Whether a node tree carries a `RepeatGroup` at all (the cheap guard callers use). */
export function hasRepeatGroup(root: A2Node): boolean {
  if (root.type === REPEAT_GROUP_NODE_TYPE) return true;
  return childArray(root.children).some((child) => hasRepeatGroup(child));
}
