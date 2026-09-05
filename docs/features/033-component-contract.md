# Form-builder component API contract

This records how the admin form-builder pieces fit. Read it before changing these shapes:
the prop types, four server-action signatures, and import-surface rules preserve state
ownership and the `"use client"` boundary.

## Who owns state

The **client** owns the working draft. `FormBuilder` is the single `"use client"` state
owner: it holds `DraftForm`, the issue list, the dirty/saved indicator, and every debounce.
Everything below it is presentational and takes `value` + `on*` callbacks. No child fetches,
no child holds a copy of the draft, no child calls a server action directly except through
a callback prop handed down from `FormBuilder`.

Server actions are passed **in as props** from the page. That keeps `components/forms/**` free of any `lib/server/` import, which the R2
import-surface test requires of a `"use client"` module.

## Shared types (already landed, import them; do not redeclare)

From `@/lib/forms/types`: `DraftForm`, `DraftStep`, `DraftPin`, `DraftCondition`,
`DraftRule`, `FormSettings`, `FormDetail`, `FormIssue`, `IssuePath`, `PinnableQuestion`,
`PinnableVersion`, `FormListItem`, `CONDITION_OPS`, `ConditionOp`, `LeafConditionOp`.

From `@/lib/forms/draft`: `addStep`, `renameStep`, `moveStep`, `removeStep`, `addPin`,
`movePin`, `removePin`, `movePinWithinStep`, `addRule`, `updateRule`, `removeRule`,
`isPinned`, `pinnedQuestionIds`, `pinnableVersions`, `isPinnable`, `pinnedVersionStatus`,
`pinLabel`, `draftDocumentOrder`, `eligibleTargets`, `unsaveableReason`, `blankDraft`,
`formIdFromSlug`.

From `@/lib/forms/condition`: `conditionForOp`, `operandKind`, `isOpSupported`,
`isCombinator`, `optionIdsOfVersion`, `typeOfPinnedVersion`, `conditionReferences`,
`conditionDepth`, `nodeAt`, `replaceAt`, `addBranch`, `removeBranch`, `MAX_CONDITION_DEPTH`,
`DATE_OPERAND_PLACEHOLDER`, `OperandKind`, `ConditionPath`.

From `@/lib/forms/issues`: `ruleAnchorId`, `stepAnchorId`, `pinAnchorId`, `anchorFor`,
`messageForIssue`, `locationOf`, `issuesForRule`, `stepIssueCounts`, `parseIssues`.

From `@/lib/forms/builder-state`: `CreateFormState`, `SaveDraftState`, `ValidateDraftState`,
`SettingsState`, `PreviewConditionState`, `PreviewOutcome`, `PreviewReason`, and the
`IDLE_*` constants.

## Server-action prop signatures (`app/(shell)/forms/actions.ts`)

These are the ONLY four the builder needs. All are `async`, all already authenticated.

```ts
type SaveDraft = (draft: DraftForm) => Promise<SaveDraftState>;
type ValidateDraft = (draft: DraftForm) => Promise<ValidateDraftState>;
type UpdateSettings = (patch: {
  challengeRequired?: boolean;
  minSubmitMs?: number | null;
}) => Promise<SettingsState>;
type PreviewCondition = (input: {
  draft: DraftForm;
  ruleId: string;
  answers: Record<string, unknown>;
}) => Promise<PreviewConditionState>;
```

`UpdateSettings` takes a **partial** patch and the caller must send only the changed keys:
the API rejects an empty patch at the schema level, so never call it with `{}`. The
settings panel tracks what the author actually changed for exactly this reason.

## Components (`components/forms/**`)

```ts
// form-builder.tsx  -- "use client", the state owner
interface FormBuilderProps {
  readonly detail: FormDetail; // includes settings + challengeProvider
  readonly library: readonly PinnableQuestion[];
  readonly saveDraft: SaveDraft;
  readonly validateDraft: ValidateDraft;
  readonly updateSettings: UpdateSettings;
  readonly previewCondition: PreviewCondition;
}

// steps-rail.tsx
interface StepsRailProps {
  readonly draft: DraftForm;
  readonly issueCounts: ReadonlyMap<string, number>; // stepId -> count
  readonly selectedStepId: string | undefined;
  readonly onSelect: (stepId: string) => void;
  readonly onAdd: (title: string) => void;
  readonly onRename: (stepId: string, title: string) => void;
  readonly onMove: (stepId: string, delta: -1 | 1) => void; // keyboard-operable, not drag-only
  readonly onRemove: (stepId: string) => void;
}

// step-editor.tsx
interface StepEditorProps {
  readonly draft: DraftForm;
  readonly step: DraftStep;
  readonly library: readonly PinnableQuestion[];
  readonly issues: readonly FormIssue[];
  readonly onAddPin: (questionId: string, version: number) => void;
  readonly onMovePin: (questionId: string, version: number) => void; // R7: one pin, one version
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1) => void;
}

// condition-editor.tsx  -- per rule
interface ConditionEditorProps {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: readonly PinnableQuestion[];
  readonly issues: readonly FormIssue[]; // already filtered to this rule
  readonly onChange: (next: DraftRule) => void;
  readonly onRemove: () => void;
}

// condition-json-pane.tsx  -- "use client", CodeMirror, SECONDARY surface
interface ConditionJsonPaneProps {
  readonly condition: DraftCondition;
  readonly draft: DraftForm;
  readonly library: readonly PinnableQuestion[];
  readonly onChange: (next: DraftCondition) => void; // called only when the text parses
  readonly label: string; // accessible name, from i18n
}

// validation-panel.tsx
interface ValidationPanelProps {
  readonly draft: DraftForm;
  readonly issues: readonly FormIssue[];
  readonly status: "idle" | "validating" | "saved" | "saving" | "error";
  readonly lastSavedAt: string | undefined;
}

// rule-test-bench.tsx  -- read-only aid, clearly labelled
interface RuleTestBenchProps {
  readonly draft: DraftForm;
  readonly rules: readonly DraftRule[];
  readonly library: readonly PinnableQuestion[];
  readonly previewCondition: PreviewCondition;
}

// form-settings-panel.tsx
interface FormSettingsPanelProps {
  readonly settings: FormSettings;
  readonly challengeProvider: string; // "none" => render the unenforceable warning
  readonly updateSettings: UpdateSettings;
}
```

## Non-negotiable behaviours

1. **Tri-state preview.** `outcome` is `match` / `noMatch` / `unavailable`. "Could not
   evaluate" must be visually and textually distinct from "no match". `reason` is present
   only when `unavailable`, and each reason gets its own sentence.
2. **`challengeProvider === "none"`** renders an inline warning next to `challengeRequired`
   saying the setting is unenforceable until an operator configures a provider. Task-file
   line 18; not optional.
3. **ADR-19 ordering.** The structured pickers and inline errors are the PRIMARY surface.
   The CodeMirror pane sits BESIDE them, never in place of them.
4. **R7 manual pins.** Every pin row shows `questionId@version` via `pinLabel()`. The move
   menu lists published versions only, one pin at a time. No auto-upgrade, no bulk move.
5. **ADR-16 targets.** The `show` picker puts `eligibleTargets()` results first and
   ineligible ones in a separate labelled group - still SELECTABLE, so a backward target
   can be attempted (exit criterion 2), with an immediate inline flag when picked.
6. **ADR-27.** No hardcoded user-facing string, including accessible names and the
   CodeMirror `aria-label`. Everything through `lib/i18n/en.ts`.
7. **Reorder is keyboard-operable** via menu commands, never drag-only.

## Kit reality (no `Switch`, `Tag`, `Accordion`, `TextArea`)

`components/kit.tsx` exports: `Alert, Breadcrumb, Button, Card, Checkbox, DatePicker,
Dialog, Form, MenuItem, MenuList, MenuPopover, MenuSeparator, MenuTrigger,
MenuTriggerButton, NumberField, Select, Table, Text, TextField`.

Use `Checkbox` for the switch, a styled `<span>` for a tag, `<details>/<summary>` for an
accordion. ADR-22 forbids another component library and adding a control to `@roonga/qcms-ui` is a
`docs/COMPONENT_GUIDELINES.md` process that is OUT OF SCOPE for 033. Report each
substitution.

## Import-surface rules that will fail your build

Over every non-test `.ts`/`.tsx` under `app/`, `components/`, `lib/`, `scripts/`:

- no `@roonga/qcms-core` import, not even `import type`;
- a `"use client"` module may not value-import anything whose specifier contains
  `lib/server/`, or `better-auth`, `@roonga/qcms-db`, `drizzle-orm`, `pg`;
- **no file may contain the literal text `.select(`, `.insert(`, `.update(`, `.delete(` or
  `.transaction(`** anywhere, comments included (raw regex over file text);
- **no file except `lib/server/api.ts` may contain `fetch(`**, comments included.

## Per-file hygiene

`pnpm exec prettier --write <file>` and `pnpm exec eslint <file>` as you finish each file,
not batched at the end. Lint reports one violation at a time and runs late inside `verify`,
so a violation found late costs a full cycle. Expect `sonarjs/cognitive-complexity` on big
components: split the function, do not disable the rule.
