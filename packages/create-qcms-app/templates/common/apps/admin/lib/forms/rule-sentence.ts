import { t, type MessageKey } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import type { ReadState } from "../read-state.ts";

import { draftDocumentOrder } from "./draft.ts";
import type {
  DraftAnswerValue,
  DraftCondition,
  DraftForm,
  DraftRule,
  LeafConditionOp,
  PinnableQuestion,
} from "./types.ts";

/**
 * One rule, written out as the sentence the read-only rules table shows.
 *
 * The Code Owner's example is the whole brief: **"When X is answered, show Y"**. A rule
 * is a `DraftCondition` tree plus a list of ids, and a reader scanning a table of them
 * should not have to hold the DSL in their head to answer "what does this one do".
 *
 * ## Why segments rather than a string
 *
 * The names in that sentence - a question's label, a step's title - are the part a reader
 * scans for, and the table emphasises them. Returning prose would force the table to find
 * them again by matching substrings, which fails the moment a label contains a comma, the
 * word "and", or the same text as a connective. So the sentence leaves here already
 * split: a name is its own segment carrying its `kind`, and every connective, comma and
 * bracket stays in a segment that has none. The table styles on the flag and never parses.
 *
 * `kind` marks **a name somebody chose**: a question label, a step title, a choice
 * option's label. It deliberately does NOT mark a value an author typed as data (a number,
 * a date, free text) - that is a comparison operand, not the identity of a thing in the
 * form - and it does not mark a stand-in that stands where a name could not be resolved,
 * because "Label not known" is not a name and emphasising it would assert that it is.
 *
 * ## What a failed library read renders, and why it is not "missing"
 *
 * `library` arrives as a {@link ReadState} for the reason `lib/read-state.ts` and
 * `pin-grid.ts` both set out at length (issues 543, 544, 572, contract §3 of
 * `plan/admin-design-contracts.md`): handed `ok ? data : []`, every lookup in this module
 * would miss, and every rule in the form would print a sentence claiming its question is
 * not in the library. That is a positive claim about a library nobody managed to read,
 * and on this screen it would read as "the rules point at nothing" for a form that is
 * perfectly intact.
 *
 * So the two are separated, and the wording is `pin-grid.ts`'s own rather than new:
 *
 * - the library answered and holds no label for this id: `forms.step.labelMissing`
 *   ("No label in the library") - a finding, and true;
 * - the library did not answer: `forms.step.labelUnknown` ("Label not known") - which
 *   says only that this is not known, and claims nothing about the form.
 *
 * The same split reaches choice operands: an option id resolves to its label only when
 * the library answered, and otherwise renders as the raw `opt_` id the rule actually
 * holds, which is honest about being an id rather than dressing one up as a name.
 *
 * A **step** title never depends on the library at all. Steps are form-owned and arrive
 * in `draft`, so a failed library read leaves every step target reading exactly as it
 * always does - which is the point of §3's rule that a failed read suppresses only what
 * it actually made unknowable.
 *
 * ## Why a nested group is always bracketed
 *
 * "A or B, and C" and "A, or B and C" are different rules and a comma cannot reliably
 * separate them, so a child `and`/`or` inside any combinator is bracketed:
 * "(A or B) and C". The test is on the child's operator rather than on
 * `conditionDepth(child) > 1`, and that is a decision rather than an oversight.
 * `conditionDepth` cannot tell the two cases apart that matter here: a `not` child has
 * depth 2 or more yet needs no brackets of its own, because `forms.sentence.not` already
 * renders as `not (...)` and is therefore self-delimiting, while a bare `and`/`or` child
 * is not. Bracketing by depth would double-bracket every `not` to no benefit. Depth is
 * the kernel's cap on nesting (`MAX_CONDITION_DEPTH`), not a claim about ambiguity.
 *
 * Nesting of the same operator ("A and (B and C)") is bracketed too, rather than
 * flattened. Flattening would print a shape the author's tree does not have, and the JSON
 * pane beside this screen shows the tree they actually wrote.
 *
 * ## Why there is no `default:` rendering an operator's own token
 *
 * `LEAF_FRAMES` is a total `Record<LeafConditionOp, ...>`, so adding an operator to the
 * DSL without wording it here is a compile error rather than a sentence that reads
 * `q_smoker startsWith daily` as though "startsWith" were English. The runtime lookup is
 * still guarded, because a draft is bytes from the API and may carry an operator this
 * build has never seen: that renders `forms.sentence.op.unknown`, which says so. It is
 * the promise `messageForIssue` in `issues.ts` already makes for an unknown publish code.
 *
 * The unknown branch names no question, on purpose. The shape of a node this build does
 * not know is exactly what it does not know, so reading `questionId` off it would be a
 * guess printed as a fact.
 *
 * ## Purity
 *
 * Everything here is a function of its three arguments. Nothing reads the network, and
 * whether a rule is legal is still the validate endpoint's answer and never this
 * module's (R2) - a sentence describing a rule the kernel would reject still renders,
 * because the author needs to read the rule in order to fix it.
 */

/** One run of the sentence: either a name the table emphasises, or the text around it. */
export interface RuleSentenceSegment {
  readonly text: string;
  /** A name the reader chose (a question, a step). The table emphasises these. */
  /**
   * What KIND of thing this segment names, when it names one.
   *
   * Not a boolean, because the read view styles a question and a value differently: a
   * sentence is scanned for "which question does this read, and what does it compare
   * against", and one weight for both makes the reader parse the prose to tell them apart.
   * Absent on connectives, punctuation and every stand-in - a stand-in is the absence of a
   * name, so emphasising it would assert one.
   */
  readonly kind?: "question" | "step" | "value";
}

/**
 * The sentence for one rule.
 *
 * Adjacent non-name runs are merged, so the result is the shortest segment list that
 * still separates every emphasised name: a table can render it with `map` and get no
 * empty spans and no split words.
 */
export function ruleSentence(
  rule: DraftRule,
  library: ReadState<readonly PinnableQuestion[]>,
  draft: DraftForm,
): readonly RuleSentenceSegment[] {
  const context = sentenceContext(library, draft);
  const condition = renderCondition(rule.when, context);
  if (rule.show.length === 0) {
    return merge(fill("forms.sentence.frameNoTargets", { condition }));
  }
  const targets = joinList(
    rule.show.map((id) => renderTarget(id, context)),
    "forms.sentence.listAnd",
  );
  return merge(fill("forms.sentence.frame", { condition, targets }));
}

// --- what a name resolves against ------------------------------------------

/**
 * The two reads a sentence needs, plus the pin index it would otherwise rebuild.
 *
 * `pinnedVersions` is built once per sentence rather than per option id: resolving a
 * choice operand's label needs the version THIS form pins (R6 and R7 - a form serves a
 * frozen version and is never auto-upgraded), and `draftDocumentOrder` is a flatMap over
 * every step. A rule with a ten-option `containsAny` would otherwise walk the whole form
 * ten times to render one cell.
 */
interface SentenceContext {
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly draft: DraftForm;
  readonly pinnedVersions: ReadonlyMap<string, number>;
}

function sentenceContext(
  library: ReadState<readonly PinnableQuestion[]>,
  draft: DraftForm,
): SentenceContext {
  const pinnedVersions = new Map<string, number>();
  for (const position of draftDocumentOrder(draft)) {
    // First pin wins. A question pinned twice is `DUPLICATE_QUESTION_IN_FORM` and the
    // engine's own answer; this only needs one version to look an option label up in.
    if (!pinnedVersions.has(position.questionId)) {
      pinnedVersions.set(position.questionId, position.version);
    }
  }
  return { library, draft, pinnedVersions };
}

/**
 * A question's display name, or the stand-in that says why there is none.
 *
 * The two stand-ins are `pin-grid.ts`'s, unchanged: reusing them is what keeps one
 * vocabulary for "the library has no label" and "the library did not answer" across the
 * pin grid and this table, rather than two screens describing the same state in two
 * different sets of words.
 */
function questionName(
  questionId: string,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (!context.library.ok) return [{ text: t("forms.step.labelUnknown") }];
  const question = context.library.data.find((entry) => entry.questionId === questionId);
  const label = textOf(question?.label ?? undefined);
  return label === ""
    ? [{ text: t("forms.step.labelMissing") }]
    : [{ text: label, kind: "question" }];
}

/**
 * One `show` target, named as the author sees it.
 *
 * `DraftRule.show` holds question ids and step ids **mixed**, exactly as the kernel's
 * `show` allows (`types.ts`), so the id is matched against the draft's steps first. That
 * order is not arbitrary: steps are form-owned and always present, so a step target
 * resolves even when the library did not answer, and only an id that is not a step is
 * worth asking the library about.
 *
 * An untitled step gets `forms.steps.untitled`, which is the same stand-in the builder's
 * step list, breadcrumb and rail already show for one (`subtree-rail.ts`).
 */
function renderTarget(id: string, context: SentenceContext): readonly RuleSentenceSegment[] {
  const step = context.draft.steps.find((candidate) => candidate.stepId === id);
  if (step === undefined) return questionName(id, context);

  // A STEP TARGET SAYS SO. `show` mixes question ids and step ids, and the two are not the
  // same act: `packages/core/src/evaluate-rules.ts` keeps step-level and question-level
  // visibility as separate layers that AND together, so showing a step is not shorthand for
  // showing the questions in it. Rendered as a bare name, "show Driving history and Extra
  // cover" gives a reader no way to tell which of those is which, and the sentence would be
  // readable and wrong - the one combination this table must not produce.
  const title = textOf(step.title);
  const name: RuleSentenceSegment =
    title === "" ? { text: t("forms.steps.untitled") } : { text: title, kind: "step" };
  return merge(fill("forms.sentence.stepTarget", { name: [name] }));
}

// --- the condition tree ------------------------------------------------------

/** Everything except the three combinators: the ops that read one question. */
type LeafCondition = Extract<DraftCondition, { readonly questionId: string }>;

/**
 * Wording for every leaf operator.
 *
 * Total over `LeafConditionOp` on purpose - see the module note on why there is no
 * `default:` branch that would render an unworded operator as if it were English.
 */
const LEAF_FRAMES: Record<LeafConditionOp, MessageKey> = {
  answered: "forms.sentence.op.answered",
  equals: "forms.sentence.op.equals",
  notEquals: "forms.sentence.op.notEquals",
  in: "forms.sentence.op.in",
  contains: "forms.sentence.op.contains",
  containsAny: "forms.sentence.op.containsAny",
  gt: "forms.sentence.op.gt",
  gte: "forms.sentence.op.gte",
  lt: "forms.sentence.op.lt",
  lte: "forms.sentence.op.lte",
};

/**
 * The same table, widened to the lookup a runtime value deserves.
 *
 * A `DraftForm` is a view of bytes the API sent (`types.ts`), so `op` is only a
 * `LeafConditionOp` as far as the compiler is concerned. Widening the key type here -
 * rather than declaring the table itself loosely, which is what `ISSUE_MESSAGES` in
 * `issues.ts` does - keeps the exhaustiveness check on {@link LEAF_FRAMES} while still
 * letting the lookup answer `undefined`.
 */
const LEAF_FRAME_FOR: Readonly<Record<string, MessageKey | undefined>> = LEAF_FRAMES;

/**
 * One condition node.
 *
 * The combinators are matched by `op` rather than through `isCombinator` from
 * `condition.ts`: that predicate narrows a `ConditionOp`, not the node carrying it, so it
 * would tell us which branch to take and leave the node un-narrowed for the branch body.
 */
function renderCondition(
  condition: DraftCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (condition.op === "and" || condition.op === "or") {
    const conjunction = condition.op === "and" ? "forms.sentence.listAnd" : "forms.sentence.listOr";
    if (condition.conditions.length === 0) return [{ text: t("forms.sentence.noBranches") }];
    return joinList(
      condition.conditions.map((child) => branch(child, context)),
      conjunction,
    );
  }
  if (condition.op === "not") {
    return fill("forms.sentence.not", { condition: renderCondition(condition.condition, context) });
  }
  return renderLeaf(condition, context);
}

/** One branch of a combinator, bracketed when it is itself a bare `and`/`or` list. */
function branch(
  condition: DraftCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  const rendered = renderCondition(condition, context);
  if (condition.op !== "and" && condition.op !== "or") return rendered;
  return fill("forms.sentence.group", { condition: rendered });
}

/** One leaf: the question it reads, the operator's wording, and its operand. */
function renderLeaf(
  condition: LeafCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  const frame = LEAF_FRAME_FOR[condition.op];
  if (frame === undefined) {
    return fill("forms.sentence.op.unknown", { op: [{ text: String(condition.op) }] });
  }
  return fill(frame, {
    question: questionName(condition.questionId, context),
    // `answered` carries no operand and its frame has no `{value}`, so an empty list here
    // is spliced into nothing rather than needing a branch of its own.
    value: renderOperand(condition, context),
  });
}

/**
 * A leaf's operand, whichever of the two shapes it carries.
 *
 * `values` (a list of whole answers: `in`, `containsAny`) reads with "or", because both
 * operators mean "any one of these matches". `value` is a single answer, and a
 * multiChoice one is itself a list of option ids compared by set equality (ADR-21), so
 * that inner list reads with "and": it is one answer made of several selections, not a
 * choice between them.
 */
function renderOperand(
  condition: LeafCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if ("values" in condition) {
    if (condition.values.length === 0) return [{ text: t("forms.sentence.emptyValue") }];
    return joinList(
      condition.values.map((value) => renderValue(value, condition.questionId, context)),
      "forms.sentence.listOr",
    );
  }
  if ("value" in condition) return renderValue(condition.value, condition.questionId, context);
  return [];
}

/** One answer value, in the vocabulary the author meets it in elsewhere. */
function renderValue(
  value: DraftAnswerValue,
  questionId: string,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  // `forms.operand.*` is what the boolean operand control itself is labelled with, so a
  // sentence saying "Yes" says the same word the author picked.
  if (typeof value === "boolean") {
    return [{ text: t(value ? "forms.operand.true" : "forms.operand.false") }];
  }
  if (typeof value === "number") return [{ text: String(value) }];
  if (typeof value === "string") return [choiceOrLiteral(value, questionId, context)];
  if (value.length === 0) return [{ text: t("forms.sentence.emptyValue") }];
  return joinList(
    value.map((optionId) => [choiceOrLiteral(optionId, questionId, context)]),
    "forms.sentence.listAnd",
  );
}

/**
 * A string operand as either the option label it names or the text it is.
 *
 * No question-type check guards this. A lookup against the pinned version's options is
 * the check: a text or date operand is not an `optionId` of anything, so it misses and
 * renders as itself, and the one string that resolves is the one that genuinely names an
 * option of this question. Reading the type first would need `typeOfPinnedVersion` and a
 * second failure mode when the library did not answer, to reach the same two outcomes.
 */
function choiceOrLiteral(
  text: string,
  questionId: string,
  context: SentenceContext,
): RuleSentenceSegment {
  if (text === "") return { text: t("forms.sentence.emptyValue") };
  const label = optionLabel(text, questionId, context);
  return label === undefined ? { text } : { text: label, kind: "value" };
}

/** The label the pinned version gives an option id, when the library answered with one. */
function optionLabel(
  optionId: string,
  questionId: string,
  context: SentenceContext,
): string | undefined {
  if (!context.library.ok) return undefined;
  const version = context.pinnedVersions.get(questionId);
  if (version === undefined) return undefined;
  const question = context.library.data.find((entry) => entry.questionId === questionId);
  const pinned = question?.versions.find((candidate) => candidate.version === version);
  const option = pinned?.definition.options?.find((candidate) => candidate.optionId === optionId);
  const label = textOf(option?.label);
  return label === "" ? undefined : label;
}

// --- assembling frames -------------------------------------------------------

/**
 * Splice segment lists into a catalog frame's placeholders.
 *
 * `t(key)` with no parameters returns the template verbatim, which is what makes this
 * possible without a second copy of the catalog: the frame is split on its own `{name}`
 * placeholders, the literal text between them becomes plain segments, and each named slot
 * is replaced by the segments built for it. A placeholder with nothing supplied for it is
 * left standing rather than silently dropped, which is the same choice `t` makes and for
 * the same reason - a visible `{value}` is a bug report, a silent gap is not.
 */
function fill(
  key: MessageKey,
  parts: Readonly<Record<string, readonly RuleSentenceSegment[]>>,
): readonly RuleSentenceSegment[] {
  const template = t(key);
  const out: RuleSentenceSegment[] = [];
  const placeholder = /\{(\w+)\}/g;
  let cursor = 0;
  for (let found = placeholder.exec(template); found !== null; found = placeholder.exec(template)) {
    out.push({ text: template.slice(cursor, found.index) });
    const replacement = parts[found[1] ?? ""];
    if (replacement === undefined) out.push({ text: found[0] });
    else out.push(...replacement);
    cursor = found.index + found[0].length;
  }
  out.push({ text: template.slice(cursor) });
  return out;
}

/**
 * A list of already-rendered items as one English list.
 *
 * "A and B" for two, "A, B and C" for three or more: the separator between the last two
 * items is the conjunction and every earlier one is a comma, which is what requirement
 * "show A and B, not show A, B" asks for and what an author reads a target list as. Both
 * separators are catalog frames, so a locale that punctuates lists differently changes
 * them there.
 */
function joinList(
  items: readonly (readonly RuleSentenceSegment[])[],
  conjunction: MessageKey,
): readonly RuleSentenceSegment[] {
  const first = items[0];
  if (first === undefined) return [];
  let joined = first;
  for (let index = 1; index < items.length; index += 1) {
    const next = items[index] ?? [];
    const separator = index === items.length - 1 ? conjunction : "forms.sentence.listComma";
    joined = fill(separator, { left: joined, right: next });
  }
  return joined;
}

/**
 * Coalesce the runs the frames left behind.
 *
 * Splicing a frame produces a segment per literal fragment, so ", show " arrives as three
 * or four pieces. A consumer rendering one element per segment would emit empty spans and
 * split a word across nodes, which breaks text selection and gives a screen reader extra
 * boundaries to announce. Two adjacent names are never merged: they are separate names,
 * and only a connective ever sits between them anyway.
 */
function merge(segments: readonly RuleSentenceSegment[]): readonly RuleSentenceSegment[] {
  const out: RuleSentenceSegment[] = [];
  for (const segment of segments) {
    if (segment.text === "") continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && previous.kind === undefined && segment.kind === undefined) {
      out[out.length - 1] = { text: previous.text + segment.text };
      continue;
    }
    out.push(segment);
  }
  return out;
}
