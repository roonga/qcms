import {
  INSTANCE_LABEL_PLACEHOLDER,
  countBounds,
  type LocaleCode,
  type QuestionDefinition,
  type QuestionRef,
  type RepeatGroup,
} from "@roonga/qcms-core";

import { questionToNode, type TextResolver } from "./mapping.js";
import type { A2UINode } from "./types.js";

/**
 * The `RepeatGroup` template node (ADR-42, ADR-43): compilation is answer-blind (ADR-14),
 * so each member control is emitted once and the renderer clones it per instance. A
 * qcms-owned type; `docs/a2ui-mapping.md` and the golden corpus carry the contract.
 */

/** The node type the renderer expands into one group per live instance. */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/**
 * Add and Remove control names by language subtag, English fallback. Nothing authored
 * supplies them, so the wording travels in the stored document (ADR-36).
 */
type RepeatActions = { readonly add: string; readonly remove: string };

export const REPEAT_ACTION_LEXICON: { readonly en: RepeatActions } & Readonly<
  Record<string, RepeatActions>
> = {
  en: { add: "Add {item}", remove: "Remove {label}" },
};

/** The placeholder the compiled `removeLabel` carries for the instance label. */
export const REMOVE_LABEL_PLACEHOLDER = "{label}";

function actionsFor(locale: LocaleCode): RepeatActions {
  const language = locale.split("-")[0] ?? "";
  // `.en` is a guaranteed key, so the fallback is total.
  return REPEAT_ACTION_LEXICON[language] ?? REPEAT_ACTION_LEXICON.en;
}

/**
 * The singular noun an Add control is named for. The instance label is the only
 * authored text naming one instance, the group's own label naming the
 * collection. Whitespace is collapsed, a removed placeholder otherwise leaving
 * a double space in the stored bytes.
 */
export function addItemNoun(instanceLabel: string): string {
  return instanceLabel
    .replaceAll(`{${INSTANCE_LABEL_PLACEHOLDER}}`, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** Substitute one placeholder without exposing the replacement to `$` expansion. */
function fill(template: string, placeholder: string, value: string): string {
  return template.replaceAll(placeholder, () => value);
}

/**
 * Compile one repeating group to its template node; every prop is a function of
 * the pinned content alone (ADR-18). Add and Remove are emitted for an `open`
 * source alone, the other two sources being sized elsewhere. Children carry the
 * bare `questionId` as `name`, as outside a group (ADR-42).
 */
export function repeatGroupNode(
  group: RepeatGroup,
  resolveQuestion: (ref: QuestionRef) => QuestionDefinition,
  resolveText: TextResolver,
  locale: LocaleCode,
): A2UINode {
  const instanceLabel = resolveText(group.instanceLabel);
  const bounds = countBounds(group.count);
  const actions = group.count.source === "open" ? actionsFor(locale) : undefined;
  const props: Record<string, unknown> = {
    groupId: group.groupId,
    label: resolveText(group.label),
    instanceLabel,
    presentation: group.presentation,
    countSource: group.count.source,
    min: bounds.min,
  };
  if (bounds.max !== undefined) props.max = bounds.max;
  if (actions !== undefined) {
    props.addLabel = fill(actions.add, "{item}", addItemNoun(instanceLabel));
    props.removeLabel = actions.remove;
  }
  return {
    type: REPEAT_GROUP_NODE_TYPE,
    props,
    children: group.items.map((item) => questionToNode(resolveQuestion(item), resolveText, locale)),
  };
}
