"use client";

import { Button, Select } from "@/components/kit";
import {
  addBranch,
  conditionDepth,
  conditionForOp,
  conditionReferences,
  isCombinator,
  isOpSupported,
  MAX_CONDITION_DEPTH,
  nodeAt,
  operandKind,
  optionIdsOfVersion,
  removeBranch,
  replaceAt,
  typeOfPinnedVersion,
  type ConditionPath,
} from "@/lib/forms/condition";
import { draftDocumentOrder } from "@/lib/forms/draft";
import {
  CONDITION_OPS,
  type ConditionOp,
  type DraftAnswerValue,
  type DraftCondition,
  type DraftForm,
  type DraftRule,
  type PinnableQuestion,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { QuestionType } from "@/lib/questions/types";
import type { ReadState } from "@/lib/read-state";

import { ConditionJsonPane } from "./condition-json-pane";
import { OperandControl, type OperandValue } from "./operand-control";

/**
 * One rule's `when` - the condition half - edited structurally (task 033; ADR-19).
 *
 * ## The pickers are the surface, the JSON is the mirror
 *
 * ADR-19 asks for "structured JSON editing with live validation", and the word doing the
 * work is *structured*: schema-aware pickers with inline errors, not a textarea holding
 * DSL. So the operator, question and value controls come first and the CodeMirror pane
 * sits beside them, showing the same node in the engine's own words for an author who
 * would rather type it. Both write through the same `onChange`, and the pickers rebuild
 * the node on every operator change (`conditionForOp`) rather than patching it, which is
 * what makes exit criterion 4 structural: there is no edit path here that can leave a
 * half-built node behind.
 *
 * ## The targets are no longer here, and that is a re-housing rather than a rewrite
 *
 * The `show` list left this file for `rule-targets.tsx` when the editor became a
 * three-phase wizard (Code Owner, 2026-08-30): "When" is this component and "Then show"
 * is that one, so a condition tree gets the room a nested boolean editor beside a JSON
 * pane actually needs. Nothing about the tree changed in the move. The reasoning about
 * why an ineligible target stays listed moved with the control it is about, to
 * `lib/forms/rule-targets.ts`, because that is now where the grouping is decided.
 *
 * This component is a PHASE PANEL now, not a card: the wizard supplies the frame, the
 * rule's identity and the footer, so what is left here is the fieldset, the tree and the
 * JSON mirror.
 */
export function ConditionEditor({
  draft,
  rule,
  library,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly onChange: (next: DraftRule) => void;
}) {
  // `qcms-scroll-x` on the panel: a condition tree is a nested boolean editor beside a
  // JSON pane, and `plan/admin-mobile-stance.md` explicitly declines to ask that it be
  // usable on a phone - only that it not be broken there. Its controls carry real
  // minimum widths that no amount of wrapping reduces (measured at 281px of
  // irreducible minimum against the 238px a rule card is given in a 320px viewport),
  // so the panel scrolls inside itself rather than handing that minimum to the page.
  // That is the stance document's own rule: wide content scrolls in its own
  // container, and the page body never scrolls horizontally at any width (issue 616).
  //
  // The wide dialog the wizard opens in is what this was always short of, and it does not
  // retire the rule: a 320px viewport still gets a dialog narrower than the tree's floor.
  return (
    <div className="qcms-scroll-x flex flex-col gap-4">
      <fieldset className="qcms-fieldset qcms-fieldset--flat">
        <legend className="qcms-fieldset__legend">{t("forms.rule.when")}</legend>
        <ConditionNode
          draft={draft}
          library={library}
          root={rule.when}
          path={[]}
          onReplace={(next) => {
            onChange({ ...rule, when: next });
          }}
        />
      </fieldset>

      <ConditionJsonPane
        condition={rule.when}
        draft={draft}
        library={library}
        label={t("forms.json.label", { ruleId: rule.ruleId })}
        onChange={(when) => {
          onChange({ ...rule, when });
        }}
      />
    </div>
  );
}

// --- the condition tree -----------------------------------------------------

interface NodeProps {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly root: DraftCondition;
  readonly path: ConditionPath;
  readonly onReplace: (next: DraftCondition) => void;
}

/** One node of the tree: a leaf's controls, or a combinator and its branches. */
function ConditionNode(props: NodeProps) {
  const node = nodeAt(props.root, props.path);
  if (node === undefined) return null;
  const leaf = asLeaf(node);
  return (
    <div className="flex flex-col gap-2 border-l border-(--color-border) pl-3">
      <OperatorSelect {...props} node={node} />
      {leaf === undefined ? (
        <CombinatorBranches {...props} node={node} />
      ) : (
        <LeafControls {...props} node={leaf} />
      )}
    </div>
  );
}

/** Every leaf variant: the ten ops that read one question. */
type LeafCondition = Extract<DraftCondition, { readonly questionId: string }>;

/** The node as a leaf, or `undefined` when it is one of the three combinators. */
function asLeaf(node: DraftCondition): LeafCondition | undefined {
  return isCombinator(node.op) ? undefined : (node as LeafCondition);
}

/**
 * The operator picker.
 *
 * Every op is listed, including the ones that do not apply to this question's type: those
 * are `disabledKeys` rather than absent, so an author sees that `containsAny` exists and
 * that it needs a multiChoice question, instead of hunting for an operator the list
 * silently dropped.
 */
function OperatorSelect({
  draft,
  library,
  root,
  path,
  node,
  onReplace,
}: NodeProps & { readonly node: DraftCondition }) {
  const leaf = asLeaf(node);
  const questionId = leaf === undefined ? firstQuestionId(draft, node) : leaf.questionId;
  const context = questionContext(draft, library, questionId);
  const unsupported = CONDITION_OPS.filter(
    (op) => !isCombinator(op) && !isOpSupported(op, context.type),
  );

  return (
    <Select
      label={t("forms.rule.op")}
      value={node.op}
      items={CONDITION_OPS.map((op) => ({ label: t(`forms.op.${op}`), value: op }))}
      disabledKeys={[...unsupported]}
      onChange={(next) => {
        const op = next as ConditionOp;
        onReplace(
          replaceAt(
            root,
            path,
            conditionForOp(op, questionId, context.type, context.options, node),
          ),
        );
      }}
    />
  );
}

/** The `and`/`or`/`not` branches, each one a whole node again. */
function CombinatorBranches({
  draft,
  library,
  root,
  path,
  node,
  onReplace,
}: NodeProps & { readonly node: DraftCondition }) {
  const children = childrenOf(node);
  const atCap = conditionDepth(root) >= MAX_CONDITION_DEPTH;
  const canBranch = node.op === "and" || node.op === "or";

  return (
    <div className="flex flex-col gap-2">
      {children.map((child, index) => (
        <div key={`${child.op}:${String(index)}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-(--color-text-muted)">
              {t("forms.rule.branchHeading", { position: index + 1 })}
            </p>
            {canBranch && children.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  onReplace(removeBranch(root, path, index));
                }}
              >
                {t("forms.rule.branchRemove", { position: index + 1 })}
              </Button>
            )}
          </div>
          <ConditionNode
            draft={draft}
            library={library}
            root={root}
            path={[...path, index]}
            onReplace={onReplace}
          />
        </div>
      ))}

      {canBranch && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={atCap}
            onPress={() => {
              onReplace(addBranch(root, path, firstQuestionId(draft, node)));
            }}
          >
            {t("forms.rule.branchAdd")}
          </Button>
          {atCap && (
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.rule.depthReached", { max: MAX_CONDITION_DEPTH })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A leaf's question picker and its operand control. */
function LeafControls({
  draft,
  library,
  root,
  path,
  node,
  onReplace,
}: NodeProps & { readonly node: LeafCondition }) {
  const questionId = node.questionId;
  const context = questionContext(draft, library, questionId);
  const kind = operandKind(node.op, context.type);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        label={t("forms.rule.question")}
        value={questionId}
        items={pinnedOptions(draft)}
        onChange={(next) => {
          // The question changes what a legal operand looks like, so the node is rebuilt
          // against the new question's type rather than having its id swapped underneath
          // an operand the new type may not accept.
          const nextContext = questionContext(draft, library, next);
          onReplace(
            replaceAt(
              root,
              path,
              conditionForOp(node.op, next, nextContext.type, nextContext.options, node),
            ),
          );
        }}
      />

      <OperandControl
        kind={kind}
        label={t("forms.rule.value")}
        options={context.options}
        value={operandOf(node)}
        onChange={(value) => {
          onReplace(replaceAt(root, path, withOperand(node, value)));
        }}
      />
    </div>
  );
}

// --- pure helpers -----------------------------------------------------------

interface QuestionContext {
  readonly type: QuestionType | undefined;
  readonly options: readonly string[];
}

/**
 * What the pinned version of one question says about its type and options.
 *
 * A library read that FAILED lands in the same branch as a question the library does not
 * hold: nothing is known about the type, so `type` is `undefined` and the operator picker
 * disables the ops that need one (issues 572, 544). That is the honest answer rather than
 * a coincidence of the old `ok ? data : []` collapse, and it is why the library arrives
 * here as a `ReadState` even though the two branches compute the same thing: a later edit
 * that wants to say something ABOUT the library has the bit to say it with, instead of
 * reaching for a fallback that has already thrown the bit away.
 */
function questionContext(
  draft: DraftForm,
  library: ReadState<readonly PinnableQuestion[]>,
  questionId: string,
): QuestionContext {
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return { type: undefined, options: [] };
  const question = library.ok
    ? library.data.find((entry) => entry.questionId === questionId)
    : undefined;
  return {
    type: typeOfPinnedVersion(question, pin.version),
    options: optionIdsOfVersion(question, pin.version),
  };
}

/** The pinned questions the question picker offers, in document order. */
function pinnedOptions(draft: DraftForm): { label: string; value: string }[] {
  return draftDocumentOrder(draft).map((entry) => ({
    label: `${entry.questionId}@${String(entry.version)}`,
    value: entry.questionId,
  }));
}

/** A question id a new node under this one can start against. */
function firstQuestionId(draft: DraftForm, node: DraftCondition): string {
  const referenced = conditionReferences(node)[0];
  if (referenced !== undefined) return referenced;
  return draftDocumentOrder(draft)[0]?.questionId ?? "";
}

function childrenOf(node: DraftCondition): readonly DraftCondition[] {
  if (node.op === "and" || node.op === "or") return node.conditions;
  if (node.op === "not") return [node.condition];
  return [];
}

/**
 * The operand a leaf currently carries, in the shape the control renders.
 *
 * `OperandValue` spans a single answer and a list of them because that is what the ten
 * leaf ops carry between them; see `asScalar` for why the union stays here rather than at
 * every call site.
 */
// eslint-disable-next-line sonarjs/function-return-type
function operandOf(node: LeafCondition): OperandValue {
  if ("values" in node) return node.values;
  if ("value" in node) return node.value;
  return "";
}

/**
 * One operand value, narrowed to a single answer.
 *
 * A list can arrive here when the author switches `in` to `equals`: a list of strings IS a
 * whole multiChoice answer, so it is kept as one, and a mixed or numeric list collapses to
 * its first string rather than producing a shape the kernel's union has no member for.
 *
 * `DraftAnswerValue` is a union of four runtime types and deciding between them is this
 * function's whole job, so the rule that wants one return type is asking for the union to
 * be pushed back out to every caller. Same call the kernel-facing `startingOperand` makes
 * in `lib/forms/condition.ts`.
 */
// eslint-disable-next-line sonarjs/function-return-type
function asScalar(value: OperandValue): DraftAnswerValue {
  if (typeof value !== "object") return value;
  const list: readonly DraftAnswerValue[] = value;
  const strings = list.filter((entry): entry is string => typeof entry === "string");
  return strings.length === list.length ? strings : (strings[0] ?? "");
}

// The element type is the closed union the kernel accepts; see `asScalar`.
function asList(value: OperandValue): readonly DraftAnswerValue[] {
  // `readonly string[]` is `DraftAnswerValue`'s one object member, so an array-of-answers
  // and a multiChoice answer are told apart by their first element rather than by
  // `Array.isArray`, which widens the narrowing to `any[]` and fails the lint gate.
  if (typeof value !== "object") return [value];
  const list: readonly DraftAnswerValue[] = value;
  return list.length === 0 ? [""] : list;
}

/**
 * Put an edited operand back into its node, keeping the node parseable.
 *
 * The node is rebuilt per op rather than spread-and-patched, because each op's operand
 * field is a different name and a different type: `in` carries `values`, `contains`
 * carries a single option id as a `string`, and the ordering ops carry `number | string`.
 * A spread would happily leave both `value` and `values` on the same node, which is
 * exactly the shape the kernel's closed union rejects.
 */
function withOperand(node: LeafCondition, value: OperandValue): DraftCondition {
  switch (node.op) {
    case "equals":
    case "notEquals":
      return { op: node.op, questionId: node.questionId, value: asScalar(value) };
    case "in":
      return { op: "in", questionId: node.questionId, values: asList(value) };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { op: node.op, questionId: node.questionId, value: asOrdered(value) };
    case "contains":
      return { op: "contains", questionId: node.questionId, value: String(asScalar(value)) };
    case "containsAny":
      return { op: "containsAny", questionId: node.questionId, values: asList(value).map(String) };
    default:
      return node;
  }
}

/**
 * An ordering operand: a number or a canonical date string, never anything else.
 *
 * `number | string` is the DSL's own type for `gt`/`gte`/`lt`/`lte` (a date compares as its
 * canonical `YYYY-MM-DD` string), so the two-typed return is the schema's shape rather than
 * an untidiness in this function.
 */
// eslint-disable-next-line sonarjs/function-return-type
function asOrdered(value: OperandValue): number | string {
  const scalar = asScalar(value);
  if (typeof scalar === "number") return scalar;
  if (typeof scalar === "string") return scalar;
  return 0;
}
