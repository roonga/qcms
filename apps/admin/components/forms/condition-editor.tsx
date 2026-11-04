"use client";

import { Button, Select, TextField } from "@/components/kit";
import { SearchableSelect } from "@/components/searchable-select";
import {
  addBranch,
  conditionDepth,
  conditionForOp,
  conditionReferences,
  isCombinator,
  isGroupOp,
  isOpSupported,
  MAX_CONDITION_DEPTH,
  nodeAt,
  operandKind,
  optionIdsOfVersion,
  removeBranch,
  replaceAt,
  typeOfPinnedVersion,
  withGroupId,
  withInstanceCount,
  type ConditionPath,
} from "@/lib/forms/condition";
import { draftDocumentOrder, draftGroups, instanceNoun } from "@/lib/forms/draft";
import {
  CONDITION_OPS,
  INSTANCE_COUNT_COMPARISONS,
  type ConditionOp,
  type DraftAnswerValue,
  type DraftCondition,
  type DraftForm,
  type DraftRule,
  type InstanceCountComparison,
  type PinnableQuestion,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { QuestionType } from "@/lib/questions/types";
import type { ReadState } from "@/lib/read-state";

import { ConditionJsonPane } from "./condition-json-pane";
import { OperandControl, type OperandValue } from "./operand-control";

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

interface NodeProps {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly root: DraftCondition;
  readonly path: ConditionPath;
  readonly onReplace: (next: DraftCondition) => void;
}

function ConditionNode(props: NodeProps) {
  const node = nodeAt(props.root, props.path);
  if (node === undefined) return null;
  return (
    <div className="flex flex-col gap-2 border-l border-(--color-border) pl-3">
      <OperatorSelect {...props} node={node} />
      <NodeControls {...props} node={node} />
    </div>
  );
}

function NodeControls(props: NodeProps & { readonly node: DraftCondition }) {
  if (isGroupOp(props.node.op)) return <GroupReadControls {...props} />;
  const leaf = asLeaf(props.node);
  if (leaf === undefined) return <CombinatorBranches {...props} />;
  return <LeafControls {...props} node={leaf} />;
}

type LeafCondition = Extract<DraftCondition, { readonly questionId: string }>;

function asLeaf(node: DraftCondition): LeafCondition | undefined {
  return isCombinator(node.op) || isGroupOp(node.op) ? undefined : (node as LeafCondition);
}

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
  const groups = draftGroups(draft);
  const unsupported = CONDITION_OPS.filter((op) =>
    isGroupOp(op) ? groups.length === 0 : !isCombinator(op) && !isOpSupported(op, context.type),
  );
  const groupId = "groupId" in node ? node.groupId : groups[0]?.groupId;

  return (
    <>
      <SearchableSelect
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
              conditionForOp(op, questionId, context.type, context.options, node, groupId),
            ),
          );
        }}
      />
      {groups.length === 0 && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.op.needsGroup")}</p>
      )}
    </>
  );
}

/* Nested group conditions count toward the kernel's depth limit; everyInstance is false for an empty
   group. */
function GroupReadControls({
  draft,
  library,
  root,
  path,
  node,
  onReplace,
}: NodeProps & { readonly node: DraftCondition }) {
  if (!("groupId" in node)) return null;
  const groups = draftGroups(draft);
  const atCap = conditionDepth(root) >= MAX_CONDITION_DEPTH;
  const chosen = groups.find((group) => group.groupId === node.groupId);
  const noun = chosen === undefined ? node.groupId : instanceNoun(chosen, draft.defaultLocale);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t("forms.rule.group")}
          value={node.groupId}
          items={groupOptions(draft)}
          onChange={(next) => {
            onReplace(replaceAt(root, path, withGroupId(node, next)));
          }}
        />
        {node.op === "instanceCount" && (
          <>
            <Select
              label={t("forms.rule.instanceCompare")}
              value={node.compare}
              items={INSTANCE_COUNT_COMPARISONS.map((compare) => ({
                label: t(`forms.rule.compare.${compare}`),
                value: compare,
              }))}
              onChange={(next) => {
                onReplace(
                  replaceAt(
                    root,
                    path,
                    withInstanceCount(node, { compare: next as InstanceCountComparison }),
                  ),
                );
              }}
            />
            <TextField
              label={t("forms.rule.instanceValue")}
              value={String(node.value)}
              inputMode="numeric"
              onChange={(next) => {
                const parsed = Number.parseInt(next.trim(), 10);
                onReplace(
                  replaceAt(
                    root,
                    path,
                    withInstanceCount(node, {
                      value: Number.isInteger(parsed) ? parsed : node.value,
                    }),
                  ),
                );
              }}
            />
          </>
        )}
      </div>

      {node.op === "everyInstance" && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-every-reading">
          {t("forms.rule.everyInstanceReading")}
        </p>
      )}

      {node.op !== "instanceCount" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-(--color-text-muted)">
            {t("forms.rule.groupBranch", { group: noun })}
          </p>
          <ConditionNode
            draft={draft}
            library={library}
            root={root}
            path={[...path, 0]}
            onReplace={onReplace}
          />
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

function groupOptions(draft: DraftForm): { label: string; value: string }[] {
  return draftGroups(draft).map((group) => {
    const label = textOf(group.label, draft.defaultLocale);
    return { label: label === "" ? group.groupId : label, value: group.groupId };
  });
}

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

interface QuestionContext {
  readonly type: QuestionType | undefined;
  readonly options: readonly string[];
}

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

function pinnedOptions(draft: DraftForm): { label: string; value: string }[] {
  return draftDocumentOrder(draft).map((entry) => ({
    label: `${entry.questionId}@${String(entry.version)}`,
    value: entry.questionId,
  }));
}

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

/* OperandValue spans scalar and list operands; narrow it only at the control matching that operator. */
// eslint-disable-next-line sonarjs/function-return-type
function operandOf(node: LeafCondition): OperandValue {
  if ("values" in node) return node.values;
  if ("value" in node) return node.value;
  return "";
}

// eslint-disable-next-line sonarjs/function-return-type
function asScalar(value: OperandValue): DraftAnswerValue {
  if (typeof value !== "object") return value;
  const list: readonly DraftAnswerValue[] = value;
  const strings = list.filter((entry): entry is string => typeof entry === "string");
  return strings.length === list.length ? strings : (strings[0] ?? "");
}

function asList(value: OperandValue): readonly DraftAnswerValue[] {
  if (typeof value !== "object") return [value];
  const list: readonly DraftAnswerValue[] = value;
  return list.length === 0 ? [""] : list;
}

/* Rebuild per operator: operand field names and types differ, so spreading a previous node can retain
   invalid fields. */
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

// eslint-disable-next-line sonarjs/function-return-type
function asOrdered(value: OperandValue): number | string {
  const scalar = asScalar(value);
  if (typeof scalar === "number") return scalar;
  if (typeof scalar === "string") return scalar;
  return 0;
}
