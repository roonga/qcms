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
 * The `RepeatGroup` template node (ADR-42, ADR-43).
 *
 * Compilation is answer-blind (ADR-14) and an instance count is
 * answer-dependent, so the compiler cannot expand a group. It emits this
 * template carrying each member control once with the bare `questionId` as its
 * `name`, and the renderer clones it per live instance and qualifies each
 * clone's name. That keeps the stored bytes the bytes published (ADR-18).
 *
 * A qcms-owned node type rather than an `@a2ra/core` registry component,
 * because nothing upstream describes a container cloned per instance and the
 * vendored component schemas are strict (ADR-22). The contract is documented in
 * `docs/a2ui-mapping.md` and carried by the golden corpus.
 *
 * The honeypot is appended to the step after this node (ADR-12), so it sits
 * outside the template and is never cloned with it.
 */

/** The node type the renderer expands into one group per live instance. */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/**
 * The lexicon the Add and Remove control names are built from, keyed by the
 * active locale's language subtag with an English fallback.
 *
 * A compiler lexicon constant frozen by `compilerVersion`, like the boolean
 * lexicon (ADR-36): the wording is part of the stored document, so a renderer
 * that is not ours has something to read and one that changes its defaults
 * cannot silently restyle a published form. Nothing authored supplies these
 * strings, so the lexicon is the whole source.
 *
 * `add` is resolved at compile time; `remove` keeps its placeholder, because the
 * instance label it names carries the live ordinal. The distinguishing words
 * come first, following APG's naming practice.
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
 * The singular noun an Add control is named for, taken from the instance-label
 * template with its placeholder removed. The instance label is the only authored
 * text naming one instance; the group's own label names the collection, so it
 * would read wrongly here. Whitespace is collapsed, so a placeholder removed
 * mid-template leaves no double space in the stored bytes.
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
 * Compile one repeating group to its template node. Every prop is a function of
 * the pinned content alone (ADR-18).
 *
 * `instanceLabel` keeps its placeholder, because the ordinal is live state. Add
 * and Remove are emitted for an `open` source alone: a `fixed` group's size is
 * its author's and a `fromAnswer` group's is the count answer's. An absent `max`
 * means a bounded source omitted one, which publish refuses (SEC-16), so the
 * renderer may treat it as unbounded.
 *
 * Children are the member controls once each, with the bare `questionId` as
 * `name`, identical to the same question outside a group (ADR-42).
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
