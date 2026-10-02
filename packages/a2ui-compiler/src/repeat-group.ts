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
 * The `RepeatGroup` **template** node (task 073, ADR-42, ADR-43, ADR-01 as
 * amended 2026-09-30).
 *
 * `compileFormWith` is pure and answer-blind - `StepResolverContext` carries the
 * snapshot, the locale and the resolvers and nothing else (ADR-14, whose 2026-09-30
 * amendment says repetition does not widen it) - and an instance count is
 * answer-dependent. So the compiler **cannot expand a group**. It emits this
 * template, carrying each member control **once** with the bare `questionId` as its
 * `name`, and the renderer clones the template per live instance at render time and
 * qualifies each clone's `name` to `ins_7k2/q_passport`.
 *
 * That keeps ADR-18 exact: the stored bytes are the bytes published, and the
 * expansion is a render-time transform on the precedent `withNativeSubmit` and
 * `documentForVisible` already set.
 *
 * **`RepeatGroup` is a qcms-owned node type**, not an `@a2ra/core` registry
 * component, on the precedent {@link HONEYPOT_NODE_TYPE} set: nothing upstream
 * describes a container whose children are cloned per instance, and the vendored
 * component schemas are `strict` (ADR-22, the vendored bytes never move). It is a
 * renderer-compat contract, documented in `docs/a2ui-mapping.md` and carried by the
 * golden corpus.
 *
 * **The honeypot is never cloned**, which is a real risk given that expansion is a
 * template clone: the decoy is appended to the step's `Flex` **after** this node
 * (task 026, ADR-12), so it sits outside the template and a ten-instance step
 * carries exactly one (acceptance case 34).
 */

/** The A2UI node `type` literal the renderer expands into one group per live instance. */
export const REPEAT_GROUP_NODE_TYPE = "RepeatGroup";

/**
 * The lexicon the Add and Remove control names are built from, keyed by the active
 * locale's language subtag with an English fallback.
 *
 * A **compiler lexicon constant frozen by `compilerVersion`**, exactly as the
 * boolean Yes/No lexicon is (ADR-36's Note: the fallback source is a compiler
 * lexicon and not an app catalog in the ADR-11 sense), and for the same reason: the
 * wording is part of the stored document, so a renderer that is not ours has
 * something to read and a renderer that changes its defaults cannot silently
 * restyle a published form. Nothing authored supplies these two strings - the
 * kernel's `RepeatGroup` carries `label` and `instanceLabel` and no action wording
 * (`packages/core/src/step.ts`) - so the lexicon is the whole source.
 *
 * `add` is resolved at compile time; `remove` keeps its `{label}` placeholder,
 * because the instance label it names carries the **live ordinal**, which is
 * render-time state. APG's naming practice puts the distinguishing words first, so
 * the name is "Remove Passenger 3" and never "Passenger 3 remove".
 */
type RepeatActions = { readonly add: string; readonly remove: string };

export const REPEAT_ACTION_LEXICON: { readonly en: RepeatActions } & Readonly<
  Record<string, RepeatActions>
> = {
  en: { add: "Add {item}", remove: "Remove {label}" },
};

/** The placeholder the compiled `removeLabel` carries for the resolved instance label. */
export const REMOVE_LABEL_PLACEHOLDER = "{label}";

function actionsFor(locale: LocaleCode): RepeatActions {
  const language = locale.split("-")[0] ?? "";
  // `.en` is a guaranteed key (typed above), so the fallback is total.
  return REPEAT_ACTION_LEXICON[language] ?? REPEAT_ACTION_LEXICON.en;
}

/**
 * The singular noun an Add control is named for, taken from the instance-label
 * template with its `{n}` removed: "Passenger {n}" gives "Passenger", so the
 * control reads "Add Passenger".
 *
 * The instance label is the only authored text that names one instance. The group's
 * own `label` names the whole collection ("Passengers"), so "Add Passengers" would
 * be wrong, and a template with no `{n}` at all is legal (a group of one) and
 * simply resolves to itself. Whitespace is collapsed so a `{n}` removed from the
 * middle of a template does not leave a double space in the stored bytes.
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
 * Compile one repeating group to its template node.
 *
 * The props are the whole of what the renderer needs to expand the group, and every
 * one of them is a function of the pinned content alone (determinism, ADR-18):
 *
 * - `groupId` - what the roster, the field names and the `__qop` button values key on.
 * - `label` - the collection's own name, the group container's accessible name.
 * - `instanceLabel` - the template, `{n}` intact, because the ordinal is live state.
 * - `presentation` - `stacked`, `perInstanceStep` or `table`. Task 073 renders
 *   `stacked` only; 076 and 077 own the other two.
 * - `countSource` - `fixed`, `fromAnswer` or `open`. The renderer shows Add and
 *   Remove for `open` alone: a `fixed` group's size is its author's and a
 *   `fromAnswer` group's is the count answer's.
 * - `min` / `max` - the declared bounds, for the renderer's own "no Remove below
 *   `min`" and "no Add at `max`" states. A `fixed` count is its own bound, so both
 *   are its `count`; `max` is **absent** only when a bounded source omitted it,
 *   which publish refuses (`REPEAT_MAX_MISSING`, SEC-16), so an absent `max` cannot
 *   reach a published snapshot and the renderer treats it as unbounded.
 * - `addLabel` / `removeLabel` - `open` only, from the lexicon above.
 *
 * Children are the member controls, **once each**, with the bare `questionId` as
 * `name` - identical to what the same question compiles to outside a group, because
 * a question does not know that it is repeated (ADR-42).
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
