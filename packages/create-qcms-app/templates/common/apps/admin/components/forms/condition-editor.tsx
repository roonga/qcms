"use client";

import { Alert, Button, Checkbox, Select } from "@/components/kit";
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
import { draftDocumentOrder, eligibleTargets } from "@/lib/forms/draft";
import { messageForIssue, ruleAnchorId } from "@/lib/forms/issues";
import {
  CONDITION_OPS,
  type ConditionOp,
  type DraftAnswerValue,
  type DraftCondition,
  type DraftForm,
  type DraftRule,
  type FormIssue,
  type PinnableQuestion,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { QuestionType } from "@/lib/questions/types";

import { ConditionJsonPane } from "./condition-json-pane";
import { OperandControl, type OperandValue } from "./operand-control";

/**
 * One rule's `{ when, show }`, edited structurally (task 033; ADR-19).
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
 * ## Why an ineligible target is still selectable
 *
 * ADR-16 evaluates in one forward pass, so a rule may only show something that comes
 * after every question its condition reads. `eligibleTargets` is pure draft geometry, so
 * the answer is instant and the picker can group the legal targets first. The illegal ones
 * are **still listed and still selectable**, under their own heading, because an author who
 * picks one deserves to be told the rule rather than to find the option missing and wonder
 * why. Picking one raises the inline flag immediately; the authority is still the validate
 * endpoint, whose `RULE_BACKWARD_TARGET` (from the kernel's own `analyzeRuleGraph`) lands
 * on this same rule a debounce later.
 */
export function ConditionEditor({
  draft,
  rule,
  library,
  issues,
  onChange,
  onRemove,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: readonly PinnableQuestion[];
  readonly issues: readonly FormIssue[];
  readonly onChange: (next: DraftRule) => void;
  readonly onRemove: () => void;
}) {
  const references = conditionReferences(rule.when);
  const eligible = eligibleTargets(draft, references);

  return (
    <section
      id={ruleAnchorId(rule.ruleId)}
      tabIndex={-1}
      data-rule-id={rule.ruleId}
      aria-label={t("forms.rule.heading", { ruleId: rule.ruleId })}
      className="flex flex-col gap-4 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="qcms-question-id text-sm">
          {t("forms.rule.heading", { ruleId: rule.ruleId })}
        </h3>
        <Button variant="ghost" size="sm" onPress={onRemove}>
          {t("forms.rule.remove", { ruleId: rule.ruleId })}
        </Button>
      </div>

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

      <TargetPicker
        draft={draft}
        rule={rule}
        eligible={eligible}
        onChange={(show) => {
          onChange({ ...rule, show });
        }}
      />

      <ConditionJsonPane
        condition={rule.when}
        draft={draft}
        library={library}
        label={t("forms.json.label", { ruleId: rule.ruleId })}
        onChange={(when) => {
          onChange({ ...rule, when });
        }}
      />

      {issues.length > 0 && (
        <ul aria-label={t("forms.rule.issues")} className="flex flex-col gap-1">
          {issues.map((issue, index) => (
            <li
              key={`${issue.code}:${String(index)}`}
              className="text-sm text-(--color-danger-fg)"
              data-issue-code={issue.code}
            >
              {messageForIssue(issue)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- targets ----------------------------------------------------------------

interface TargetGroups {
  readonly questions: readonly string[];
  readonly steps: readonly string[];
}

/**
 * The `show` list: every question and step in the form, eligible ones first.
 *
 * Checkboxes rather than a multi-select, for the reason the operand's option set uses
 * them: `show` is a set, the kit has no multi-select (ADR-22 forbids adding one here), and
 * a group whose every member shows its own state is what a keyboard user can work through
 * without a popup.
 */
function TargetPicker({
  draft,
  rule,
  eligible,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly eligible: TargetGroups;
  readonly onChange: (show: readonly string[]) => void;
}) {
  const all = allTargets(draft);
  const eligibleIds = new Set([...eligible.questions, ...eligible.steps]);
  const backward = rule.show.filter((target) => !eligibleIds.has(target));

  const toggle = (target: string, isSelected: boolean) => {
    onChange(
      isSelected ? [...rule.show, target] : rule.show.filter((candidate) => candidate !== target),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="qcms-fieldset qcms-fieldset--flat">
        <legend className="qcms-fieldset__legend">{t("forms.rule.show")}</legend>
        {all.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.rule.targetsNone")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <TargetGroup
              legend={t("forms.rule.targetsEligible")}
              targets={all.filter((target) => eligibleIds.has(target.id))}
              selected={rule.show}
              onToggle={toggle}
            />
            <TargetGroup
              legend={t("forms.rule.targetsIneligible")}
              targets={all.filter((target) => !eligibleIds.has(target.id))}
              selected={rule.show}
              onToggle={toggle}
            />
          </div>
        )}
      </fieldset>

      {backward.length > 0 && (
        <div data-testid="qcms-backward-flag" data-rule-id={rule.ruleId}>
          <Alert variant="warning">
            {t("forms.rule.backwardWarning", { targets: backward.join(", ") })}
          </Alert>
        </div>
      )}
    </div>
  );
}

interface TargetOption {
  readonly id: string;
  readonly label: string;
}

/** Every addressable target: pinned questions in document order, then the steps. */
function allTargets(draft: DraftForm): readonly TargetOption[] {
  const questions = draftDocumentOrder(draft).map((entry) => ({
    id: entry.questionId,
    label: entry.questionId,
  }));
  const steps = draft.steps.map((step) => ({
    id: step.stepId,
    label: t("forms.rule.targetStep", { stepId: step.stepId }),
  }));
  return [...questions, ...steps];
}

function TargetGroup({
  legend,
  targets,
  selected,
  onToggle,
}: {
  readonly legend: string;
  readonly targets: readonly TargetOption[];
  readonly selected: readonly string[];
  readonly onToggle: (target: string, isSelected: boolean) => void;
}) {
  if (targets.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-(--color-text-muted)">{legend}</p>
      <div className="flex flex-wrap gap-3">
        {targets.map((target) => (
          <Checkbox
            key={target.id}
            label={target.label}
            isSelected={selected.includes(target.id)}
            onChange={(isSelected) => {
              onToggle(target.id, isSelected);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// --- the condition tree -----------------------------------------------------

interface NodeProps {
  readonly draft: DraftForm;
  readonly library: readonly PinnableQuestion[];
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

/** What the pinned version of one question says about its type and options. */
function questionContext(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
  questionId: string,
): QuestionContext {
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return { type: undefined, options: [] };
  const question = library.find((entry) => entry.questionId === questionId);
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
