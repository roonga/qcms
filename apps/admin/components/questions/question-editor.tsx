"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, Button, Checkbox, Select, TextField } from "@/components/kit";
import { ManualSaveNote } from "@/components/save-model";
import { t } from "@/lib/i18n/en";
import {
  blankDefinition,
  forWire,
  localizedDraft,
  questionIdFromSlug,
  textOf,
} from "@/lib/questions/definition";
import {
  chooseQuestionPanel,
  resetQuestionPanel,
  useQuestionPanel,
  usePublishQuestionPanels,
} from "@/lib/questions/editor-bridge";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import {
  fieldErrorProps,
  issuesByField,
  optionalProp,
  unplacedIssues,
} from "@/lib/questions/errors";
import {
  DEFAULT_QUESTION_PANEL,
  firstPanelWithIssue,
  panelAnchorId,
  panelIssueCounts,
  questionPanels,
  renderedQuestionFields,
  type QuestionPanel,
  type QuestionPanelId,
} from "@/lib/questions/panels";
import {
  QUESTION_TYPES,
  type ChoiceOptionView,
  type ConstraintsView,
  type DefinitionIssue,
  type QuestionDefinitionView,
  type QuestionType,
  type ValidationMessagesView,
} from "@/lib/questions/types";

import { ConstraintsEditor } from "./constraints-editor";
import { BooleanLabelsEditor, MessagesEditor } from "./messages-editor";
import { OptionGridEditor } from "./option-grid-editor";

/**
 * The question editor (task 032; screen contract "editor `form`").
 *
 * One component for both creating and editing, because they are the same form with two
 * fields unlocked: creation is the only moment `slug` and `type` can be chosen, and the
 * whole point of the screen is that this is a one-way door. Splitting them into two
 * components would duplicate the constraint panels, the option editor, the error
 * placement and the submit handling to express a two-field difference.
 *
 * ## The document is held here, and sent as one field
 *
 * The form posts a single serialized `definition`, assembled from this component's state.
 * The alternative - a form field per constraint, reassembled on the server - would put
 * "which constraints does a `date` question have?" inside the BFF, which is a domain
 * question the admin has no authority over (R2). Sending the document whole keeps the
 * server side to `JSON.parse` and forward, and keeps the kernel the only thing that has
 * ever decided what a question is.
 *
 * **This costs nothing in reach: the admin requires JavaScript** (Code Owner, 2026-09-27).
 * The sentence here used to offer 031's credential screens as the counterweight - "those
 * still work with JavaScript off" - which read as though a no-script floor were a property
 * this app trades against screen by screen. It is not one, and it never was the reason those
 * screens are plain-form POSTs: they are named route handlers so that **credentials never
 * pass through client JavaScript at all** (ADR-35, SEC-1). That is a security boundary rather
 * than a degradation budget, and it is unaffected by what this editor needs.
 *
 * ## ONE PANEL AT A TIME, CHOSEN FROM THE RAIL (Code Owner, 2026-09-27)
 *
 * The sections used to be stacked in one column: label, help text, required, the option
 * grid, the constraints, the messages, the boolean labels, and the Save button under all of
 * them. On a nine-option single choice that is a screen and a half of scrolling before an
 * author reaches a constraint, and the save is somewhere past the end of it.
 *
 * `lib/questions/panels.ts` decides which panels this document has and what is in each, and
 * the rail beside this column renders one row per panel under the selected version
 * (`components/questions/question-panel-rows.tsx`). This component renders exactly the one the
 * address names. Three things follow, and each is deliberate:
 *
 * - **The address decides the first paint, not this component.** `?panel=` arrives as
 *   `addressedPanel`, resolved on the server by the same `panelFromParams` the rail's slot
 *   reads, so the marked row and the rendered panel agree before a line of JavaScript runs,
 *   and a reload lands where the author was. `lib/questions/editor-bridge.ts` holds only what
 *   the reader has since CHOSEN.
 * - **The panels themselves are republished as the document changes**, so the rail's digests
 *   and its rows follow what is typed rather than the last save: setting a constraint makes
 *   the Validation messages row appear, and adding an option changes "8 options" to "9".
 * - **`/questions/new` shows every panel at once**, because it has no rail and therefore
 *   nothing to switch them with. That screen is the one place the old stacked column survives,
 *   and it is the right place for it: creation is a single pass through a short document.
 *
 * ## Where errors land
 *
 * The kernel reports issues by domain path, so `["constraints","maxSelected"]` is exactly
 * the address of the "Most selections" field. Every issue whose path matches a rendered
 * field is shown on that field; anything left over is listed in the alert at the top
 * rather than dropped, which is what makes "every error is surfaced somewhere readable"
 * hold for codes this screen has never seen.
 *
 * **With one panel on screen, "shown on that field" needs a second half**, or a refusal about
 * a constraint would mark a field in a panel the author is not looking at. So a refused save
 * opens the first panel carrying an issue and moves focus into it - see `focusPanel` below.
 * That path is this component's own and needs no rail: below `--bp-sidebar` the rail is a shut
 * `<details>`, and the panel still switches and the focus still lands.
 */

/**
 * One stable empty list, so "no issues" is one value rather than a new array each render.
 *
 * `state.issues ?? []` was the obvious spelling and it is the reason the memos below would
 * never have held: a fresh array every render invalidates every dependency chained off it, so
 * the rail would be republished on every keystroke in the label field.
 */
const NO_ISSUES: readonly DefinitionIssue[] = [];

export function QuestionEditor({
  mode,
  action,
  initialSlug,
  initialDefinition,
  version,
  isFrozen = false,
  addressedPanel,
  preview,
}: {
  readonly mode: "create" | "edit";
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly initialSlug: string;
  readonly initialDefinition: QuestionDefinitionView;
  readonly version: number;
  readonly isFrozen?: boolean;
  /**
   * The panel `?panel=` names, resolved on the server, or absent on a screen with no rail.
   *
   * Absent means "show every panel": `/questions/new` passes nothing, because it has no rail
   * to switch them from and creation is one pass through a short document.
   */
  readonly addressedPanel?: QuestionPanelId;
  /**
   * The saved version's preview, rendered by the server, or absent where there is none.
   *
   * A slot rather than an import, the same seam the rail takes its lifecycle actions through:
   * compiling a preview is a server read (`getPreview`) and this is a client component, so
   * what crosses is the finished subtree. `/questions/new` passes nothing, which is also what
   * keeps a Preview row off the one screen with no saved version to show.
   */
  readonly preview?: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_MUTATION);
  // Seeded from the rejected submission when there is one, so a refusal that arrived via
  // a pre-hydration full POST (see `MutationState.submitted`) still shows the author the
  // document they wrote rather than an empty form under an error message.
  const [slug, setSlug] = useState(state.submitted?.slug ?? initialSlug);
  const [definition, setDefinition] = useState<QuestionDefinitionView>(
    state.submitted?.definition ?? initialDefinition,
  );
  // WHAT THE SERVER LAST STORED, for the one panel that shows it rather than the document
  // being typed. Seeded from the version this editor mounted on and moved forward by a save
  // that landed, so "the preview is behind" is a fact about this session rather than a guess.
  const [saved, setSaved] = useState(state.submitted?.definition ?? initialDefinition);
  // And the same restoration when the form was hydrated, where the component is not
  // remounted and the initialiser above never runs again. Adjusting state during render
  // (rather than in an effect) is React's documented answer for "derive from a prop that
  // just changed": it re-renders before the browser paints, so no empty intermediate
  // frame is ever shown.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.submitted !== undefined) {
      setSlug(state.submitted.slug);
      setDefinition(state.submitted.definition);
    }
    if (state.status === "saved") setSaved(definition);
  }

  const isCreate = mode === "create";
  const questionId = isCreate ? questionIdFromSlug(slug) : definition.questionId;
  const issueList = state.issues ?? NO_ISSUES;
  const issues = issuesByField(issueList);

  /** Changing the type in creation starts a fresh document: constraints do not carry. */
  function changeType(next: QuestionType): void {
    setDefinition(blankDefinition(next, questionId));
  }

  function patch(fields: Partial<QuestionDefinitionView>): void {
    setDefinition((current) => ({ ...current, ...fields }));
  }

  // Memoized on the state objects rather than recomputed, so the rail is woken when the
  // document or the verdict changes and not when React re-renders this form for any other
  // reason. `definition` and `issueList` are both stable between edits.
  const panels = useMemo(
    () => questionPanels(definition, { withPreview: preview !== undefined }),
    [definition, preview],
  );
  const counts = useMemo(() => panelIssueCounts(panels, issueList), [panels, issueList]);
  const leftover = unplacedIssues(issueList, renderedQuestionFields(panels));

  // WHICH PANEL IS OPEN. The address's answer unless the reader has chosen another, which is
  // `lib/questions/editor-bridge.ts`'s whole job and the Settings rail's mechanism.
  //
  // The fallback to Content when the open panel is not in the list is the one guard this needs:
  // a panel can VANISH under the reader - clearing the last constraint removes Validation
  // messages, and changing a draft's type on the creation screen removes Options - and the
  // builder's "no fallback to the first step" reasoning does not apply here, because Content
  // always exists and is the only panel a question cannot be saved without. An empty column
  // would be the alternative.
  const chosen = useQuestionPanel(addressedPanel ?? DEFAULT_QUESTION_PANEL);
  const open = panels.some((panel) => panel.id === chosen) ? chosen : DEFAULT_QUESTION_PANEL;
  const shown = addressedPanel === undefined ? panels : panels.filter((panel) => panel.id === open);

  // Hand the rail this document's panels and the counts its badges are drawn from. Nothing
  // else crosses: the selection lives in the module both trees read, and the document stays
  // this component's.
  usePublishQuestionPanels(
    useMemo(
      () => (addressedPanel === undefined ? undefined : { panels, issueCounts: counts }),
      [addressedPanel, panels, counts],
    ),
  );

  // Forget the reader's chosen panel as this editor goes away. Module state outlives a route,
  // and the page keys this component by question and version, so a remount is exactly the
  // moment the address becomes the authority again. `resetQuestionPanel` says what goes wrong
  // without it.
  useEffect(
    () => () => {
      resetQuestionPanel();
    },
    [],
  );

  // THE REFUSED SAVE, IN TWO PASSES. Sending focus needs the panel to be on screen, and
  // choosing the panel is a render, so the panel is chosen here and focused in the effect
  // below - which React runs after the render that put it there.
  const [focusPanel, setFocusPanel] = useState<QuestionPanelId | undefined>(undefined);
  const summary = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const first = firstPanelWithIssue(panels, counts);
    if (first === undefined) {
      // NOTHING A PANEL CAN SHOW, so the summary is where the author has to read it. This is
      // the other half of exit criterion 1's "every error surfaced somewhere readable": an
      // issue at a path no field renders is listed at the top of the form, and with the form
      // now one panel deep that list is the only place it appears.
      summary.current?.focus();
      return;
    }
    setFocusPanel(first);
    // Through the same call a rail row makes, so the address follows the author here too: a
    // reload after a refusal lands back on the panel that has to be fixed rather than on
    // Content. On `/questions/new` there is nothing to choose - every panel is already on
    // screen - so the call is skipped and only the focus moves.
    if (addressedPanel !== undefined) chooseQuestionPanel(first);
    // Keyed on the verdict object, which `useActionState` replaces per result, so each refusal
    // runs this once. It also runs on mount for a refusal that arrived through a full POST
    // before hydration, which is the same behaviour for the same reason.
  }, [state]);
  useEffect(() => {
    if (focusPanel === undefined) return;
    setFocusPanel(undefined);
    const section = document.getElementById(panelAnchorId(focusPanel));
    if (section === null) return;
    (firstInvalidControl(section) ?? section).focus();
  }, [focusPanel]);

  // THE PREVIEW PANEL IS NOT PART OF THE FORM, and that is structural rather than tidy. It is
  // a compiled respondent view with live controls of its own - a theme picker, a mode picker
  // and the question's own control - and every one of those inside this `<form>` would be
  // posted with the document, or would block the native submit on a constraint the editor
  // never set. So the panel renders INSTEAD of the form rather than inside it.
  //
  // The document survives the switch: it lives in this component's state, not in the DOM, so
  // walking to Preview and back returns to exactly what was typed. There is no Save footer
  // here either, by contract §6's own rule - a panel with nothing to save says nothing.
  if (preview !== undefined && open === "preview" && addressedPanel !== undefined) {
    return (
      <section
        id={panelAnchorId("preview")}
        tabIndex={-1}
        className="qcms-question-panel flex flex-col gap-4"
        data-question-panel="preview"
      >
        {/* SAID ONLY WHEN IT IS TRUE (Code Owner, 2026-09-27). The preview is compiled by the
            API from the STORED version, so an author who has typed a new label and not saved
            is looking at the old one. Standing text would be noise on the common case (a
            frozen version, or a draft opened and not touched); this appears exactly when the
            document in the editor and the document behind the preview have diverged. */}
        {hasUnsavedEdits(definition, saved) && (
          <Alert variant="warning">{t("questions.preview.stale")}</Alert>
        )}
        {preview}
      </section>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5"
      // React 19 resets a form automatically once its action resolves. That is right for an
      // uncontrolled form (the inputs are the state, so clearing them is the point) and
      // wrong for this one, which is fully controlled: `definition` above is the single
      // source of truth and every visible control is driven from it, so a reset does not
      // clear the document - it desynchronizes the controls from the document that owns
      // them. react-aria honours the cancellation explicitly (`useFormReset` skips its work
      // when the reset event is `defaultPrevented`), so this is the vendored stack's own
      // opt-out rather than a workaround pushed past it.
      //
      // Left un-prevented, every constraint control silently reverted to its mount-time
      // value the moment "Draft saved." appeared: the date panel visibly blanked, and the
      // numeric panel dropped its bounds without even a warning, because the reset arrives
      // as an `onChange` and this editor believes its own controls. The next save would
      // then have persisted the emptied document over the one just stored.
      //
      // `onResetCapture`, not `onReset`, and that is the fix rather than a detail of it.
      // react-aria subscribes with `addEventListener` on the form itself, so its handler
      // runs in the target phase; React delegates both props to the root container, where
      // capture runs before the target and bubble runs after it. Cancelling in the bubble
      // phase sets `defaultPrevented` a beat too late for react-aria to read, which looks
      // exactly like the fix not working.
      onResetCapture={(event) => {
        event.preventDefault();
      }}
    >
      {/* The whole document, as one field. See the note above on why. The hidden fields are
          outside the panels on purpose: a panel is what the author is looking at, and what
          gets POSTed is the document rather than the panel. */}
      <input type="hidden" name="definition" value={JSON.stringify(forWire(definition))} />
      <input type="hidden" name="questionId" value={questionId} />
      <input type="hidden" name="version" value={String(version)} />
      {/* In creation the slug is a real field; here it is carried so a rejected save can
          echo the whole submission back intact. */}
      {!isCreate && <input type="hidden" name="slug" value={slug} />}

      {state.status === "error" && (
        // A FOCUSABLE WRAPPER, because the summary is a focus destination now: when a refusal
        // names nothing any panel renders, this is where the author is sent. `tabIndex={-1}`
        // so it is reachable when something sends focus to it and never a stop on the way
        // past - the device `stepAnchorId`'s span uses in the builder's rail.
        <div ref={summary} tabIndex={-1} data-testid="qcms-question-errors">
          <Alert variant="error" {...optionalProp("title", state.message)}>
            {leftover.length > 0 && (
              <ul className="flex flex-col gap-1">
                {leftover.map((issue) => (
                  <li key={`${issue.code}:${(issue.path ?? []).join(".")}`}>
                    {issue.path === undefined || issue.path.length === 0
                      ? issue.message
                      : `${issue.path.join(" / ")}: ${issue.message}`}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}
      {state.status === "saved" && <Alert variant="success">{t("questions.editor.saved")}</Alert>}

      {shown.map((panel) => (
        // ONE SECTION PER PANEL, CARRYING THE ID THE RAIL ROW CONTROLS. A plain `<section>`
        // with no accessible name, deliberately: naming it would make it a `region` landmark,
        // and five landmarks inside one card is five entries in a screen reader's landmark
        // list for what is one form. The panel's own name is its fieldset's legend, inside.
        //
        // `tabIndex={-1}` because it is the fallback focus destination when a refusal names a
        // panel but no control inside it reports itself invalid.
        <section
          key={panel.id}
          id={panel.anchorId}
          tabIndex={-1}
          className="qcms-question-panel"
          data-question-panel={panel.id}
        >
          <PanelBody
            panel={panel}
            definition={definition}
            issues={issues}
            isFrozen={isFrozen}
            isCreate={isCreate}
            slug={slug}
            questionId={questionId}
            onSlug={(next) => {
              setSlug(next);
              patch({ questionId: questionIdFromSlug(next) });
            }}
            onType={changeType}
            onPatch={patch}
          />
        </section>
      ))}

      {/* THE SAVE STAYS IN THIS COLUMN, AS A STICKY FOOTER (Code Owner, 2026-09-27). It is not
          moved into the rail, and that is the decision rather than an omission: below
          `--bp-sidebar` the rail collapses to a shut `<details>`, so a Save button inside it
          would be a save an author has to expand a navigation to reach. Sticky is what answers
          the problem moving it was meant to answer - the option grid and the constraint panel
          are both taller than a viewport, and the button was below them.

          The manual save model, stated where the author will meet it (issue 518;
          `plan/admin-design-contracts.md` §6). It sits before the button in DOM order so a
          linear read reaches it on the way to the control, and it is deliberately not on
          the frozen branch: a frozen version has no Save button, and contract §6 says a
          screen with nothing to save says nothing. There is no companion "Saved 14:02"
          strip here, by the same rule - the builder's ambient chrome is for the one screen
          that autosaves, and putting it beside a Save button is the confusion
          `plan/admin-ux-audit.md` §4.6 describes rather than the fix for it. */}
      {!isFrozen && (
        // STICKY ON THE DETAIL SCREEN, IN FLOW ON THE CREATION SCREEN, and the difference is
        // not a taste. The sticky footer answers "Save is below a panel taller than the
        // viewport", which is the version card's problem: that screen shows ONE panel beside a
        // 240px rail, so the button lands clear of the viewport's own bottom-left corner.
        //
        // `/questions/new` has no rail and shows every panel at once, so a pinned footer put
        // the primary action flush into that corner - which is where `next dev` paints its own
        // tools indicator, and the indicator then owns the hit test. Every admin browser spec
        // reaches this screen through `createDraft`, so one unclickable button there is the
        // whole suite. The creation screen keeps the plain block it always had, which is also
        // what contract §6 describes for a single pass through a short document.
        <div className={isCreate ? "flex flex-col gap-2" : "qcms-question-editor__footer"}>
          <ManualSaveNote
            messageKey={isCreate ? "questions.create.manualModel" : "questions.editor.manualModel"}
          />
          <div>
            <Button type="submit" variant="primary" size="md" isDisabled={isPending}>
              {isCreate ? t("questions.create.submit") : t("questions.editor.save")}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Whether the editor is holding something the preview cannot be showing yet.
 *
 * Compared through {@link forWire}, which is what a save actually sends, so whitespace an
 * author is part-way through typing and a constraint they set and cleared again both read as
 * "no change" - the same normalisation the API would apply. Comparing the raw drafts would
 * announce a stale preview for an edit that is not one.
 */
function hasUnsavedEdits(draft: QuestionDefinitionView, saved: QuestionDefinitionView): boolean {
  return JSON.stringify(forWire(draft)) !== JSON.stringify(forWire(saved));
}

/** What every panel body is handed. Assembled once, because five of them want overlapping cuts. */
interface PanelBodyProps {
  readonly panel: QuestionPanel;
  readonly definition: QuestionDefinitionView;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
  readonly isCreate: boolean;
  readonly slug: string;
  readonly questionId: string;
  readonly onSlug: (next: string) => void;
  readonly onType: (next: QuestionType) => void;
  readonly onPatch: (fields: Partial<QuestionDefinitionView>) => void;
}

/**
 * The fields of one panel.
 *
 * A switch rather than a map of components, because the five bodies take five different cuts
 * of the same props and a uniform signature would be a props object with five optional halves.
 * The exhaustiveness is what matters and TypeScript checks it: adding a member to
 * `QUESTION_PANELS` without a branch here is a type error rather than an empty panel.
 */
function PanelBody(props: PanelBodyProps) {
  const { panel, definition, issues, isFrozen, onPatch } = props;
  switch (panel.id) {
    case "content":
      return <ContentPanel {...props} />;
    case "options":
      return (
        <OptionGridEditor
          options={definition.options ?? []}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(options: readonly ChoiceOptionView[]) => {
            onPatch({ options });
          }}
        />
      );
    case "constraints":
      return (
        <ConstraintsEditor
          type={definition.type}
          constraints={definition.constraints ?? {}}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(constraints: ConstraintsView) => {
            onPatch({ constraints });
          }}
        />
      );
    case "messages":
      return (
        <MessagesEditor
          definition={definition}
          issues={issues}
          isFrozen={isFrozen}
          onChange={(messages: ValidationMessagesView) => {
            onPatch({ messages });
          }}
        />
      );
    case "booleanLabels":
      return (
        <BooleanLabelsEditor
          definition={definition}
          issues={issues}
          isFrozen={isFrozen}
          onChange={onPatch}
        />
      );
    // Never reached: the preview is not a set of fields, so it returns above this switch,
    // outside the `<form>`. The branch exists because `QUESTION_PANELS` is exhaustive here and
    // that exhaustiveness is what makes a sixth panel a type error rather than a blank column.
    case "preview":
      return null;
  }
}

/**
 * What a respondent reads: the label, the help text, and whether an answer is required. Plus,
 * in creation only, the two fields that can never be changed again.
 *
 * A fieldset with a legend like the other four panels, where these three used to be loose
 * controls at the top of the form. The rail row names this panel and the legend names the
 * section it opens, and they are the same string for the reason
 * `apps/admin/app/(shell)/AGENTS.md` gives: a screen must not carry two names for one place.
 *
 * THE SLUG AND THE TYPE LIVE HERE, in creation, rather than in a panel of their own. They are
 * the same question the label is - what is this question - and they exist for one screen only.
 * A sixth panel that appeared on `/questions/new` and nowhere else would be a rail row that no
 * rail ever shows.
 */
function ContentPanel({
  panel,
  definition,
  issues,
  isFrozen,
  isCreate,
  slug,
  questionId,
  onSlug,
  onType,
  onPatch,
}: PanelBodyProps) {
  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{panel.label}</legend>
      <div className="flex flex-col gap-4">
        {isCreate && (
          <>
            <TextField
              name="slug"
              label={t("questions.create.slug")}
              description={t("questions.create.slugHint")}
              value={slug}
              isRequired
              onChange={onSlug}
            />
            <div className="qcms-id-callout">
              <p className="text-xs uppercase tracking-wide text-(--color-text-muted)">
                {t("questions.create.id")}
              </p>
              <p className="qcms-id-callout__value">
                {questionId === "" ? t("questions.create.idPending") : questionId}
              </p>
              <p className="text-sm text-(--color-text-muted)">{t("questions.create.idNote")}</p>
            </div>
            <Select
              label={t("questions.create.type")}
              description={t("questions.create.typeNote")}
              value={definition.type}
              items={QUESTION_TYPES.map((type) => ({
                label: t(`questions.type.${type}`),
                value: type,
              }))}
              onChange={(next) => {
                onType(next as QuestionType);
              }}
            />
          </>
        )}
        {/* THE TYPE IS NOT RESTATED IN EDIT MODE. "Type is locked to Long text." stood here
            until 2026-09-27; the rail's details group says it once now, beside the slug and
            the created date, which are the question's other permanent facts (R6). Two
            sentences for one immutable fact was one too many, and the one inside the editor
            was the one constraining the editor. */}
        <TextField
          label={t("questions.editor.label")}
          value={textOf(definition.label)}
          isRequired
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "label")}
          onChange={(next) => {
            onPatch({ label: localizedDraft(next) ?? {} });
          }}
        />
        <TextField
          label={t("questions.editor.help")}
          description={t("questions.editor.helpHint")}
          value={textOf(definition.help)}
          isDisabled={isFrozen}
          {...fieldErrorProps(issues, "help")}
          onChange={(next) => {
            onPatch({ help: localizedDraft(next) });
          }}
        />
        <Checkbox
          label={t("questions.editor.required")}
          isSelected={definition.required === true}
          isDisabled={isFrozen}
          onChange={(selected) => {
            onPatch({ required: selected });
          }}
        />
      </div>
    </fieldset>
  );
}

/**
 * What to focus inside a composite control that reports itself invalid, in the order a reader
 * would want it: the field they type into, then a date segment, then anything else focusable.
 *
 * THE ORDER IS THE WHOLE POINT and a single selector list cannot express it, because
 * `querySelector` answers in DOM order rather than in selector order. A vendored `NumberField`
 * is a `group` whose first focusable descendant is its **decrement stepper**, so the obvious
 * one-liner sent focus to a minus button beside the field that was at fault rather than into
 * the field. That reads as the focus move not working.
 */
const INVALID_TARGETS = [
  'input:not([type="hidden"]), textarea, select',
  '[role="spinbutton"]',
  'button, [tabindex="0"], [tabindex]',
] as const;

/**
 * The control a refused save should land on inside a panel, or `null` when none says it is
 * invalid.
 *
 * `aria-invalid="true"` is what react-aria puts on a control it has been told is in error
 * (`fieldErrorProps` is the one thing that sets it), so it is the honest way to ask the
 * rendered DOM which field the kernel objected to - rather than mapping a kernel path back
 * onto a selector here, which would be a third copy of the panel-to-fields relationship.
 *
 * The second hop is for the composite controls, which carry the flag on a wrapper that cannot
 * take focus: a `NumberField` on its `group`, a `DatePicker` on the group holding its segments.
 */
function firstInvalidControl(root: HTMLElement): HTMLElement | null {
  const flagged = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (flagged === null) return null;
  if (flagged.matches('input:not([type="hidden"]), textarea, select')) return flagged;
  for (const selector of INVALID_TARGETS) {
    const found = flagged.querySelector<HTMLElement>(selector);
    if (found !== null) return found;
  }
  return null;
}
