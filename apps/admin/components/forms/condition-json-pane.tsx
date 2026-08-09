"use client";

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { optionIdsOfVersion, typeOfPinnedVersion } from "@/lib/forms/condition";
import { draftDocumentOrder } from "@/lib/forms/draft";
import { CONDITION_OPS, type DraftCondition, type DraftForm } from "@/lib/forms/types";
import type { PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * The schema-aware JSON view of one rule's condition (task 033, ADR-19, ADR-22 exception).
 *
 * ## Secondary, deliberately
 *
 * ADR-19 orders these two surfaces and this is the second one. The structured pickers
 * beside this pane are where a condition is normally built, because every edit there goes
 * through `conditionForOp` and therefore cannot produce a shape the kernel rejects. This
 * pane is the escape hatch and the explanation: it shows the author the DSL their pickers
 * are writing, and lets them paste or hand-edit one when that is faster. Text that does
 * not parse changes nothing - the pickers keep the last condition that did.
 *
 * ## Why the editor is loaded, and owned, outside React
 *
 * CodeMirror owns its own DOM subtree and its own transaction model, so it cannot sit
 * inside React's reconciliation: the view is created once against a ref'd host element and
 * destroyed on unmount, and React never renders into it. Everything the editor needs from
 * the outside (the draft, the library, the change callback) is read through a ref that is
 * refreshed on every render, so the long-lived listeners always see current data without
 * being torn down and rebuilt.
 *
 * The modules are `import()`ed inside the effect rather than at the top of the file, for
 * two reasons and both are worth keeping: the whole CodeMirror bundle then loads only when
 * an author actually opens a rule, and it never runs during server rendering, where there
 * is no `document` for it to attach to. Until it arrives the pane renders the same JSON as
 * plain text, so the condition is readable before hydration and in the screenshot gate.
 *
 * ## Accessibility, which is load-bearing for the axe gate
 *
 * CodeMirror's content DOM carries `role="textbox"` and `aria-multiline="true"` but
 * deliberately sets **no accessible name**, which fails axe's `aria-input-field-name`. The
 * name is supplied here through `EditorView.contentAttributes`, from the catalog rather
 * than a literal (ADR-27). `defaultKeymap` binds no Tab, so Tab still moves focus out of
 * the editor and a keyboard user is never trapped in it.
 *
 * ## The three completion sources
 *
 * `op`, `questionId` and `optionId`, exactly as the task names them, and all three come
 * from the draft rather than from a JSON Schema: there is no schema to load here, because
 * `@roonga/qcms-core` is not importable from this app at all. `questionId` offers the questions
 * this form **pins**, and `optionId` offers the options of the **pinned version** of the
 * question the surrounding node reads - which is precisely the pair a moved pin can
 * invalidate, so offering anything wider would be teaching the wrong thing.
 */
export function ConditionJsonPane({
  condition,
  draft,
  library,
  onChange,
  label,
}: {
  readonly condition: DraftCondition;
  readonly draft: DraftForm;
  readonly library: readonly PinnableQuestion[];
  readonly onChange: (next: DraftCondition) => void;
  readonly label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [isReady, setReady] = useState(false);
  const [problem, setProblem] = useState<"parse" | "shape" | null>(null);

  const text = JSON.stringify(condition, null, 2);

  // Everything the long-lived CodeMirror extensions need, refreshed every render.
  const latest = useRef({ draft, library, onChange, text });
  latest.current = { draft, library, onChange, text };

  useEffect(() => {
    let cancelled = false;
    const created: { current: EditorView | null } = { current: null };

    const boot = async (): Promise<void> => {
      const parent = host.current;
      if (parent === null) return;
      const [state, viewModule, langJson, lintModule, autocomplete, commands] = await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/lang-json"),
        import("@codemirror/lint"),
        import("@codemirror/autocomplete"),
        import("@codemirror/commands"),
      ]);
      if (cancelled) return;

      const editor = new viewModule.EditorView({
        state: state.EditorState.create({
          doc: latest.current.text,
          extensions: [
            langJson.json(),
            lintModule.linter(langJson.jsonParseLinter()),
            autocomplete.autocompletion(),
            langJson.jsonLanguage.data.of({
              autocomplete: (context: CompletionContext) => completeCondition(context, latest),
            }),
            commands.history(),
            viewModule.keymap.of([
              ...commands.defaultKeymap,
              ...commands.historyKeymap,
              ...autocomplete.completionKeymap,
              ...lintModule.lintKeymap,
            ]),
            viewModule.EditorView.lineWrapping,
            viewModule.EditorView.contentAttributes.of({ "aria-label": label }),
            viewModule.EditorView.theme(PANE_THEME),
            viewModule.EditorView.updateListener.of((change) => {
              if (!change.docChanged) return;
              setProblem(readDocument(change.state.doc.toString(), latest.current.onChange));
            }),
          ],
        }),
        parent,
      });
      created.current = editor;
      view.current = editor;
      setReady(true);
    };

    void boot();
    return () => {
      cancelled = true;
      created.current?.destroy();
      view.current = null;
    };
    // The label alone: it is baked into the editor's content attributes at build time, so a
    // different accessible name means a different editor. It is derived from the rule id and
    // therefore constant for the life of one pane, so in practice this runs exactly once and
    // the author's cursor is never rebuilt underneath them.
  }, [label]);

  // Push a condition the PICKERS changed into the document, and nothing else. When the
  // author is the one typing, the text they typed and the condition it produced are the
  // same JSON, so this comparison is what keeps their cursor where they left it.
  useEffect(() => {
    const editor = view.current;
    if (editor === null) return;
    const current = editor.state.doc.toString();
    if (sameJson(current, text)) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  }, [text, isReady]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--color-text-muted)">{t("forms.json.note")}</p>
      <div ref={host} data-testid="qcms-condition-json" />
      {!isReady && (
        <pre className="qcms-tabular overflow-x-auto rounded-md border border-(--color-border) bg-(--color-background) p-2 text-sm text-(--color-text)">
          {text}
        </pre>
      )}
      {problem !== null && (
        <p role="status" className="text-sm text-(--color-danger-fg)">
          {problem === "parse" ? t("forms.json.parseError") : t("forms.json.shapeError")}
        </p>
      )}
    </div>
  );
}

/** The pane's colours, taken from the ADR-30 tokens so it follows every mode. */
const PANE_THEME = {
  "&": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
  },
  "&.cm-focused": {
    outline: "2px solid var(--color-focus-ring)",
    outlineOffset: "2px",
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    caretColor: "var(--color-text)",
    padding: "0.5rem",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-text)" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  },
};

/**
 * Read the document, and push it up only when it is a condition.
 *
 * Two refusals, and they are different states an author needs told apart: text that is not
 * JSON at all (mid-edit, almost always) and JSON that is not a condition (a paste of the
 * wrong thing). Neither touches the draft, so the pickers keep working from the last shape
 * that was one.
 */
function readDocument(
  raw: string,
  onChange: (next: DraftCondition) => void,
): "parse" | "shape" | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "parse";
  }
  if (!isCondition(parsed)) return "shape";
  onChange(parsed);
  return null;
}

/**
 * A structural check, not a validation.
 *
 * The kernel is the only thing that decides whether a condition is legal and it is not
 * importable here (R2), so this asks the one question the *editor* needs answered before
 * it re-renders its pickers from a value: is there an `op` the pickers know how to draw?
 * Anything past that is the validate endpoint's answer and arrives as an issue.
 */
function isCondition(value: unknown): value is DraftCondition {
  if (typeof value !== "object" || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return typeof op === "string" && (CONDITION_OPS as readonly string[]).includes(op);
}

/** Whether two documents are the same JSON, ignoring whitespace and key order artefacts. */
function sameJson(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
  } catch {
    return false;
  }
}

// --- completion -------------------------------------------------------------

/** What the pane's extensions read on every keystroke, always the current render's. */
interface PaneContext {
  readonly current: {
    readonly draft: DraftForm;
    readonly library: readonly PinnableQuestion[];
  };
}

/** The JSON keys whose string values this pane can complete. */
const COMPLETABLE_KEYS = ["op", "questionId", "value", "values"] as const;

type CompletableKey = (typeof COMPLETABLE_KEYS)[number];

/**
 * The one completion source, registered on the JSON language's data facet.
 *
 * It works from the **key the cursor's string belongs to** rather than from a regex over
 * the whole node, which is what keeps the patterns linear (a quantifier inside a quantifier
 * is what `sonarjs/super-linear-regex` rejects, for good reason on something that runs per
 * keystroke) and what makes it correct inside a nested `and` / `or` tree.
 */
function completeCondition(context: CompletionContext, pane: PaneContext): CompletionResult | null {
  const match = context.matchBefore(/"\w*/);
  if (match === null) return null;
  const before = context.state.doc.sliceString(0, match.from);
  const key = nearestKey(before);
  if (key === undefined) return null;

  const options = optionsFor(key, before, pane);
  if (options.length === 0) return null;
  // One past the opening quote: the completion replaces the partial id, not the quote.
  return { from: match.from + 1, options };
}

function optionsFor(key: CompletableKey, before: string, pane: PaneContext): Completion[] {
  if (key === "op") {
    return CONDITION_OPS.map((op) => ({ label: op, type: "keyword", detail: t(`forms.op.${op}`) }));
  }
  if (key === "questionId") return pinnedQuestionCompletions(pane);
  return optionCompletions(before, pane);
}

/** The completable key the cursor's string belongs to: the nearest one before it. */
function nearestKey(before: string): CompletableKey | undefined {
  let found: CompletableKey | undefined;
  let at = -1;
  for (const key of COMPLETABLE_KEYS) {
    const index = before.lastIndexOf(`"${key}"`);
    if (index > at) {
      at = index;
      found = key;
    }
  }
  return found;
}

/** Every question this form pins, in document order, with its label as the detail line. */
function pinnedQuestionCompletions(pane: PaneContext): Completion[] {
  const { draft, library } = pane.current;
  return draftDocumentOrder(draft).map((entry) => {
    const question = library.find((candidate) => candidate.questionId === entry.questionId);
    const detail = textOf(question?.label ?? undefined);
    return detail === ""
      ? { label: entry.questionId, type: "variable" }
      : { label: entry.questionId, type: "variable", detail };
  });
}

/**
 * The option ids of the **pinned version** of the question this node reads.
 *
 * A version's options are its own (R6), so completing from any other version would offer
 * ids the kernel will report as `DANGLING_OPTION_REF`. Finding the question by scanning
 * back to the nearest `"questionId"` is what makes this right inside a nested tree, where
 * several nodes each read a different question.
 */
function optionCompletions(before: string, pane: PaneContext): Completion[] {
  const questionId = nearestQuestionId(before);
  if (questionId === undefined) return [];
  const { draft, library } = pane.current;
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return [];
  const question = library.find((candidate) => candidate.questionId === questionId);
  const type = typeOfPinnedVersion(question, pin.version);
  if (type !== "singleChoice" && type !== "multiChoice") return [];
  return optionIdsOfVersion(question, pin.version).map((optionId) => ({
    label: optionId,
    type: "enum",
    detail: `${questionId}@${String(pin.version)}`,
  }));
}

/** Linear, no nested quantifier: one capture of everything up to the closing quote. */
const QUESTION_ID_VALUE = /"questionId"\s*:\s*"([^"]*)"/;

function nearestQuestionId(before: string): string | undefined {
  const at = before.lastIndexOf('"questionId"');
  if (at === -1) return undefined;
  return QUESTION_ID_VALUE.exec(before.slice(at))?.[1];
}
