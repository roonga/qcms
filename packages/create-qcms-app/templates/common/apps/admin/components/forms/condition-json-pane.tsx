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
import type { ReadState } from "@/lib/read-state";

/* CodeMirror owns its DOM and transaction state; React must not reconcile inside the host. Parse failures
   leave the last valid condition intact. */
export function ConditionJsonPane({
  condition,
  draft,
  library,
  onChange,
  label,
}: {
  readonly condition: DraftCondition;
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly onChange: (next: DraftCondition) => void;
  readonly label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [isReady, setReady] = useState(false);
  const [problem, setProblem] = useState<"parse" | "shape" | null>(null);

  const text = JSON.stringify(condition, null, 2);

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
    // Keep the editor view for the pane's lifetime so parent updates do not rebuild the author's cursor.
  }, [label]);

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
        <pre className="qcms-tabular qcms-scroll-x rounded-md border border-(--color-border) bg-(--color-background) p-2 text-sm text-(--color-text)">
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
    fontFamily: "var(--font-mono)",
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

function isCondition(value: unknown): value is DraftCondition {
  if (typeof value !== "object" || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return typeof op === "string" && (CONDITION_OPS as readonly string[]).includes(op);
}

function sameJson(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
  } catch {
    return false;
  }
}

interface PaneContext {
  readonly current: {
    readonly draft: DraftForm;
    readonly library: ReadState<readonly PinnableQuestion[]>;
  };
}

const COMPLETABLE_KEYS = ["op", "questionId", "value", "values"] as const;

type CompletableKey = (typeof COMPLETABLE_KEYS)[number];

function completeCondition(context: CompletionContext, pane: PaneContext): CompletionResult | null {
  const match = context.matchBefore(/"\w*/);
  if (match === null) return null;
  const before = context.state.doc.sliceString(0, match.from);
  const key = nearestKey(before);
  if (key === undefined) return null;

  const options = optionsFor(key, before, pane);
  if (options.length === 0) return null;
  return { from: match.from + 1, options };
}

function optionsFor(key: CompletableKey, before: string, pane: PaneContext): Completion[] {
  if (key === "op") {
    return CONDITION_OPS.map((op) => ({ label: op, type: "keyword", detail: t(`forms.op.${op}`) }));
  }
  if (key === "questionId") return pinnedQuestionCompletions(pane);
  return optionCompletions(before, pane);
}

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

function pinnedQuestionCompletions(pane: PaneContext): Completion[] {
  const { draft, library } = pane.current;
  return draftDocumentOrder(draft).map((entry) => {
    const question = library.ok
      ? library.data.find((candidate) => candidate.questionId === entry.questionId)
      : undefined;
    const detail = textOf(question?.label ?? undefined);
    return detail === ""
      ? { label: entry.questionId, type: "variable" }
      : { label: entry.questionId, type: "variable", detail };
  });
}

/* Complete options from the pinned question version; another version's ids could create dangling
   references. */
function optionCompletions(before: string, pane: PaneContext): Completion[] {
  const questionId = nearestQuestionId(before);
  if (questionId === undefined) return [];
  const { draft, library } = pane.current;
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return [];
  const question = library.ok
    ? library.data.find((candidate) => candidate.questionId === questionId)
    : undefined;
  const type = typeOfPinnedVersion(question, pin.version);
  if (type !== "singleChoice" && type !== "multiChoice") return [];
  return optionIdsOfVersion(question, pin.version).map((optionId) => ({
    label: optionId,
    type: "enum",
    detail: `${questionId}@${String(pin.version)}`,
  }));
}

const QUESTION_ID_VALUE = /"questionId"\s*:\s*"([^"]*)"/;

function nearestQuestionId(before: string): string | undefined {
  const at = before.lastIndexOf('"questionId"');
  if (at === -1) return undefined;
  return QUESTION_ID_VALUE.exec(before.slice(at))?.[1];
}
