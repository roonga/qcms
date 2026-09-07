"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { AmbientSaveStatus, AutosaveFlash } from "@/components/save-model";
import { AUTOSAVE_DEBOUNCE_MS, useDraftAutosave } from "@/lib/forms/autosave";
import type { SaveDraftState, SettingsState, ValidateDraftState } from "@/lib/forms/builder-state";
import {
  addPinAt,
  addStep,
  blankDraft,
  movePin,
  movePinWithinStep,
  moveStep,
  removePin,
  removeStep,
  renameStep,
} from "@/lib/forms/draft";
import { ruleAnchorId, rulesHref, stepAnchorId, stepIssueCounts } from "@/lib/forms/issues";
import { hasSettingsChange, settingsPatch } from "@/lib/forms/settings";
import type { DraftForm, FormDetail, FormSettings, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { AgentProvenanceTag } from "./agent-provenance-tag";
import { AssistPanel } from "./assist-panel";
import { FormSettingsPanel } from "./form-settings-panel";
import { RulesLens } from "./rules-lens";
import { SaveNotices } from "./save-notices";
import { concurrentNoticeCookie } from "@/lib/builder-notice";
import { currentScreenName } from "./builder-breadcrumb";
import { usePublishBuilderRail, type BuilderSelection } from "@/lib/forms/builder-bridge";
import { StepEditor } from "./step-editor";
import { ValidationPanel } from "./validation-panel";

/**
 * The form builder (task 033; screen contract `admin-form-builder.md`).
 *
 * ## Two screens since issue #669, and the rules are on a route
 *
 * It was three. Rule editing was a SELECTION here from 2026-08-26, because
 * `plan/admin-ux-audit.md` §5.5 refused a rules ROUTE on the grounds that every rule-scoped
 * validation anchor would resolve to nothing. The Code Owner ruled on 2026-09-05 that
 * `plan/admin-shell-poc/rules-screen-poc.html` is built as drawn, with the constraint that
 * makes the split safe: the anchors are rebuilt as route-plus-fragment links rather than
 * left as bare fragments. So this route keeps the form's own details and one step's editor,
 * and `components/forms/rules-lens.tsx` is the compact read-only card
 * `admin-shell-poc.html` draws in their place.
 *
 * ## One state owner
 *
 * This component holds the working draft and nothing below it does. Every child is
 * presentational: it takes a `value` and calls back, and the mutation itself is one of the
 * pure helpers in `lib/forms/draft.ts`. That is what keeps "what is on screen" a single
 * value rather than a set of copies that have to be kept in step, and it is why the JSON
 * pane and the condition pickers cannot disagree: they edit the same node through the same
 * callback.
 *
 * Since 2026-08-29 it holds the form's SETTINGS too, which are not part of the draft and
 * go to a route of their own. They are here for the reason everything else is: the panel
 * that renders them is unmounted whenever the reader is looking at a step, and state that
 * can be unmounted mid-debounce is state that can be lost without saying so.
 *
 * ## Autosave is advisory (022), and the loop itself lives one module along
 *
 * `lib/forms/autosave.ts` owns the debounce, the two round trips and the rule that a failed
 * read never becomes a fabricated all-clear. It is shared rather than inlined because issue
 * #669 gave this app a SECOND screen holding a working draft, and two copies of a save loop
 * are two save models with one name (`plan/admin-design-contracts.md` §6). What stays here
 * is everything specific to this screen: the settings, the agent-assisted marker, and the
 * three-way split of what the column shows.
 *
 * The *instant* flag an author sees the moment they pick a backward target is a different
 * mechanism entirely: `eligibleTargets`, pure draft geometry, inside the condition editor.
 *
 * ## The actions arrive as props
 *
 * A `"use client"` module may not import `lib/server/`, so the page binds each action to
 * this route's form id and passes it down. The form id therefore comes from the route
 * rather than from anything the client can edit.
 *
 * ## The library is a `ReadState`, and it stays one all the way down (issues 572, 544)
 *
 * `library` used to arrive as `ok ? data : []`, which is the collapse issue 544 filed: a
 * library that could not be read became indistinguishable from a library with nothing in
 * it. The builder passes the `ReadState` (`lib/read-state.ts`) on unchanged to the step
 * editor, the rules section and the test bench rather than unwrapping it here, so no part
 * of this tree can quietly reintroduce the empty-array fallback for its own convenience,
 * and each part decides for itself what a failure means to it. Two of them find that it
 * means nothing new (an unknown question type is an unknown question type however it came
 * to be unknown); the step editor and the picker find that it means two statements about
 * the library have to stand down. The draft, and everything that edits it, is untouched:
 * it came from a read that succeeded.
 */

export function FormBuilder({
  detail,
  library,
  formActions,
  formMeta,
  concurrentNoticeRead,
  saveDraft,
  validateDraft,
  updateSettings,
  assist,
}: {
  readonly detail: FormDetail;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /**
   * Publish and close/reopen, rendered on the form screen.
   *
   * A node rather than an import: `FormActions` is a server component carrying actions
   * already bound to this form's id, and a client component can neither bind one nor
   * render one it imported. Handing it down as a prop is how a client boundary carries
   * server-rendered content, and it keeps the publish surface out of this bundle.
   */
  readonly formActions: ReactNode;
  /**
   * The form's name, identity line and draft origin, rendered on the form screen.
   *
   * A node for the same reason {@link formActions} is one: the page composes it from the
   * server's own read of the form, and the builder only decides which of its two screens
   * it belongs on - the form's own details, or one step. The `<h1>` travelling
   * with it is why the other two promote their own headings to `h1` - see those branches
   * below.
   */
  /** The form's id, locale, status and draft origin, as one muted line under the heading. */
  readonly formMeta: ReactNode;
  /**
   * Whether this operator has already dismissed the concurrent-edit warning.
   *
   * Read from the request's cookie by the page, so the first render is already right.
   */
  readonly concurrentNoticeRead: boolean;
  readonly saveDraft: (
    draft: DraftForm,
    agentAssisted?: boolean,
    newQuestions?: readonly unknown[],
  ) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly updateSettings: (patch: {
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  }) => Promise<SettingsState>;
  /* `previewCondition` is NOT a prop here any more (issue #669). The rule test bench is
     the only thing that ever called it, and the bench went with the rules to their own
     route; `app/(shell)/forms/[formId]/rules/page.tsx` binds the action there. */
  /**
   * Task 041's chat panel, present only when `agentAuthoringEnabled()` is true on the
   * server. Absent rather than `undefined`-and-hidden: the page never passes this prop
   * at all when the flag is off, so there is no assist affordance anywhere in this
   * tree to find, not merely one that renders nothing.
   */
  readonly assist?: { readonly endpoint: string };
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  // THE FORM'S SETTINGS, held here beside the draft (Code Owner, 2026-08-29).
  //
  // They are not part of the draft and they never will be: a draft is a document under
  // construction and these are two deployment switches with their own route. What changed
  // is who holds them while they are being edited. `FormSettingsPanel` used to, along with
  // its own Save button, and `plan/admin-design-contracts.md` §6 now gives this screen one
  // save model instead of two.
  //
  // The state could not stay in the panel once the press went away. The form screen
  // unmounts the moment the reader selects a step in the rail, which would cancel a
  // debounce the panel owned and lose the edit waiting on it - silently, with no press
  // left unpressed to explain it. Up here nothing unmounts until the route does.
  //
  // `stored` is what the API last confirmed and `settings` is what the controls show. Both
  // are needed: the patch is the difference between them, and the route refuses a body
  // carrying neither key.
  const [storedSettings, setStoredSettings] = useState<FormSettings>(detail.settings);
  const [settings, setSettings] = useState<FormSettings>(detail.settings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | undefined>(undefined);
  // OPENS ON THE FORM, not on the first step, and that is the drawing rather than a
  // preference: `plan/admin-shell-poc/admin-shell-poc.html` gives its Form row
  // `aria-current="page"` in the markup it ships. It is also the honest landing for a
  // screen whose rail now lists the steps - the reader picks the one they came for
  // instead of being dropped into whichever one happens to be first.
  const [selection, setSelection] = useState<BuilderSelection>({ kind: "form" });
  // Task 041's provenance marker. Seeded from the server's own read of the stored
  // draft, then kept in step with whatever each save's response reports - the source
  // of truth for "does this draft carry an agent-assisted change" is the API, not a
  // local guess this component makes about its own history.
  const [agentAssisted, setAgentAssisted] = useState(detail.draftAgentAssisted);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | undefined>(
    detail.draftUpdatedAt ?? undefined,
  );

  // Task 041: whether the *next* save the loop below fires should carry
  // `agentAssisted: true`. Declared before the hook because the hook's `saveDraft` reads
  // it; set only by the assist panel's Accept, and read once by the save that follows it -
  // an ordinary keystroke edit after that save reverts to the default (no flag sent),
  // because the marker is an assertion about one save, not a mode this component stays in.
  const pendingAgentAssisted = useRef(false);

  // Task 041 / issue #823: the proposal's NEW question definitions, waiting for the save
  // that will create them. Held until a save actually succeeds, not cleared on read like
  // the marker above, and the difference is the point. The accepted draft PINS these
  // questions, so a save that stores the draft without creating them is exactly the
  // defect #823 reports. If the accept is refused - a definition the authoring boundary
  // will not take - nothing was written, and the next save must try the whole thing
  // again rather than quietly storing dangling pins.
  const pendingNewQuestions = useRef<readonly unknown[]>([]);

  // THE SAVE LOOP, shared with the rules screen (`lib/forms/autosave.ts`, issue #669).
  //
  // The verdict it hands back is `undefined` until a check has landed, never `[]`: a seeded
  // empty list is an initial value the panel and the pin grid used to render as a verdict -
  // "No issues. Everything here would pass a publish." beside the Publish button, on a form
  // whose stored draft may be full of them (issue 625).
  const autosave = useDraftAutosave({
    draft,
    saveDraft: (next) => {
      const agentAssistedSave = pendingAgentAssisted.current;
      pendingAgentAssisted.current = false;
      const newQuestions = pendingNewQuestions.current;
      return saveDraft(
        next,
        agentAssistedSave || newQuestions.length > 0 ? true : undefined,
        newQuestions,
      );
    },
    validateDraft,
    onSaved: (saved) => {
      // Created, so nothing is left to create. Cleared only here: a refused accept leaves
      // them pending so the retry is the whole accept again.
      pendingNewQuestions.current = [];
      if (saved.agentAssisted !== undefined) setAgentAssisted(saved.agentAssisted);
      if (saved.updatedAt !== undefined && saved.updatedAt !== "") {
        setDraftUpdatedAt(saved.updatedAt);
      }
    },
  });
  const { issues, warnings, status, lastSavedAt, saveError, paused } = autosave;

  // `updateSettings` lives in a ref, and that is not a style choice. It arrives already
  // bound to this route's form id, so the page hands down a NEW function identity on every
  // server render - and `updateSettingsAction` calls `revalidatePath` on this exact path,
  // which causes one. An effect that depended on the prop would therefore re-arm its
  // debounce because it had just saved, save again, revalidate again, and never stop.
  // Reading it through a ref keeps the effect's inputs what they actually are: the two
  // settings values. The draft's own two actions need no ref here because
  // `useDraftAutosave` holds them in one of its own, for the same reason.
  const settingsAction = useRef(updateSettings);
  settingsAction.current = updateSettings;

  const mutate = (next: DraftForm) => {
    autosave.markDirty();
    setDraft(next);
  };

  // The one name for the screen being shown, shared with the breadcrumb so the two cannot
  // drift. `currentScreenName` takes the published snapshot rather than the selection,
  // because that is what the crumb outside this tree can also read.
  const screenName = currentScreenName(selection, draft.steps);

  // The settings, on the same debounce and deliberately the same shape as the draft's loop
  // (Code Owner, 2026-08-29). One save model on this screen means one way of saving, so
  // this is `useDraftAutosave` with the second round trip removed: settings have no issues
  // to validate and no `paused` state, because there is no such thing as a settings pair
  // that cannot be stored. It shares that loop's debounce constant rather than declaring a
  // second one - a settings autosave settling at its own moment would be a second timing
  // the one strip reported as one save state.
  //
  // `settingsPatch` is what arms it. Once a save lands, `stored` catches up with what the
  // controls show, the patch is empty, and this returns without arming anything - which is
  // what stops a save from causing the next one. It is also why the effect can depend on
  // both values rather than on a dirty flag: "nothing to send" is a computed fact here
  // rather than a remembered one.
  useEffect(() => {
    const patch = settingsPatch(storedSettings, settings);
    if (!hasSettingsChange(patch)) return undefined;
    setSettingsSaving(true);
    const timer = setTimeout(() => {
      void (async () => {
        const result = await settingsAction.current.call(null, patch);
        setSettingsSaving(false);
        if (result.status === "error") {
          // `stored` is left alone on purpose, so the patch survives and the controls keep
          // showing what the author asked for rather than snapping back to a value the API
          // never accepted. Nothing retries: a refusal here is a refusal of this exact
          // patch (the route caps the override at an hour), so retrying it on a timer
          // would fail forever and say so forever.
          setSettingsError(result.message);
          return;
        }
        setSettingsError(undefined);
        // The API's echo when there is one, and the patch applied when there is not.
        // Falling back to `settings` would be wrong: the author may have moved a switch
        // while this was in flight, and taking their newer value as confirmed would drop
        // the save it still needs.
        setStoredSettings(result.settings ?? { ...storedSettings, ...patch });
        // THE SAME TIMESTAMP the draft's save writes, not one of this scope's own. §6
        // gives the screen exactly one statement of when work was stored, the ambient
        // strip is it, and the settings now feed it rather than growing a rival to it.
        autosave.markSavedAt(new Date().toISOString());
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settings, storedSettings]);

  // THE STEP THE READER ASKED FOR, when they arrived asking for one.
  //
  // Every step row on the other seven form screens is a link to `/forms/{id}#step-{stepId}`,
  // and so is the rail's own list here before this component has hydrated. Landing on this
  // screen from one of them used to show the FORM: the fragment named an element, the
  // browser scrolled to it, and the selection stayed on its default. Clicking a step and
  // getting the form's settings is the bug that reported this, and it read as intermittent
  // because after hydration the same rows are buttons that select properly - so it only
  // happened on a first click, or from another screen.
  //
  // Mount only. A later hash change is the validation panel moving focus to a pin or a
  // step, which `IssueEntry` already handles by selecting the owning step itself; re-running
  // this on every hash change would fight it.
  useEffect(() => {
    // A RULE ADDRESS THAT PREDATES THE SPLIT (issue #669). `#rules` was the rail's link
    // target on the other seven screens and `#rule-{ruleId}` was the publish rejection's,
    // and both selected a screen that no longer exists here. Nothing in the app emits
    // either any more - every one of those links carries the route now - but a bookmark or
    // a pasted URL still can, and the ruling's own standard is that no behaviour disappears
    // silently in the move. So the fragment is forwarded rather than ignored: same
    // fragment, correct route, and `RulesScreen` focuses the rule on arrival.
    //
    // `location.replace` rather than the router: this is a legacy address arriving on a
    // FIRST load, so there is no soft transition to preserve and no history entry worth
    // keeping - the URL the reader typed was never a place to go Back to. It also keeps
    // this component out of the router context, which nothing else in it needs.
    const hash = window.location.hash;
    const rulePrefix = `#${ruleAnchorId("")}`;
    if (hash === "#rules") {
      window.location.replace(rulesHref(draft.formId));
      return;
    }
    if (hash.startsWith(rulePrefix)) {
      window.location.replace(`${rulesHref(draft.formId)}${hash}`);
      return;
    }

    const prefix = `#${stepAnchorId("")}`;
    if (!hash.startsWith(prefix)) return;
    const stepId = hash.slice(prefix.length);
    // Only a step this draft actually has. A stale link to a removed step selects nothing
    // rather than emptying the editor.
    if (!draft.steps.some((step) => step.stepId === stepId)) return;
    setSelection({ kind: "step", stepId });
    // Deliberately empty: this is about the ARRIVAL, not about every later draft change.
  }, []);

  // No fallback to the first step. A selection that names a step this draft no longer has
  // is not "some other step", it is nothing, and the handlers below move the selection back
  // to the form rather than letting the editor guess.
  const selectedStep =
    selection.kind === "step"
      ? draft.steps.find((step) => step.stepId === selection.stepId)
      : undefined;
  // The step rail badges a step only when its count is ABOVE zero, so it has no all-clear
  // to fabricate: with no verdict it renders no badges and asserts nothing, which is the
  // same silence §7's form-subtree rail keeps on the other seven screens when a dry run
  // could not be had (`lib/server/form-rail.ts`). Collapsing the absence to an empty list
  // here is therefore safe, and it is the only place in this file where that is true.
  const counts = stepIssueCounts(issues ?? [], draft);

  // Hand the rail this draft's steps and the handlers that change them. `useMemo` because
  // the bridge republishes whenever the object identity changes, and a fresh object every
  // render would wake every subscriber on every keystroke in the editor beside it.
  usePublishBuilderRail(
    useMemo(
      () => ({
        draft,
        issueCounts: counts,
        selection,
        chooseForm: () => {
          setSelection({ kind: "form" });
        },
        choose: (stepId: string) => {
          setSelection({ kind: "step", stepId });
        },
        add: (title: string) => {
          const next = addStep(draft, title);
          mutate(next);
          // Adding a step is a request to work on it, so the screen goes there. The guard
          // is for the impossible case rather than a real one: `addStep` always appends.
          const added = next.steps[next.steps.length - 1];
          if (added !== undefined) setSelection({ kind: "step", stepId: added.stepId });
        },
        rename: (stepId: string, title: string) => {
          mutate(renameStep(draft, stepId, title));
        },
        move: (stepId: string, delta: -1 | 1) => {
          mutate(moveStep(draft, stepId, delta));
        },
        remove: (stepId: string) => {
          mutate(removeStep(draft, stepId));
          // The screen cannot stay on a step that no longer exists, and the form is the
          // one destination that is always there. Falling to a neighbouring step would be
          // choosing on the author's behalf which of the remaining ones they meant.
          if (selection.kind === "step" && selection.stepId === stepId) {
            setSelection({ kind: "form" });
          }
        },
      }),
      [draft, counts, selection, mutate],
    ),
  );

  /**
   * Task 041's Accept: the same `mutate` every other edit goes through, plus a flag
   * for the save the debounce above will run next. The builder's own autosave and
   * validation loop is what actually stores this - nothing here calls `saveDraft`.
   *
   * The proposal's new question definitions ride along on that same save (issue #823).
   * They are stored in one transaction with the draft that pins them, so the accept
   * either produces a draft plus its unpublished question drafts or produces nothing:
   * there is no state in which this screen shows a pin to a question no create ever
   * made, which is what it used to render as "Unknown / Version not found".
   *
   * The selection needs looking at first, and this is the one edit in the builder that
   * can invalidate it wholesale. Every other mutation changes a part of the draft; a
   * proposal REPLACES it, so the step this screen is showing may simply not be in what
   * the author just accepted. The rule is already written, one screen over, in the
   * rail's own `remove` handler: the screen cannot stay on a step that no longer
   * exists, and the form is the one destination that is always there. Without this the
   * builder lands on a blank column - `selectedStep` resolves to nothing and the step
   * branch renders `null` - one press after the author accepted a change they were
   * told would rewrite the form, with nothing on screen saying so.
   */
  function acceptAssistProposal(proposedDraft: DraftForm, newQuestions: readonly unknown[]) {
    pendingAgentAssisted.current = true;
    pendingNewQuestions.current = newQuestions;
    if (
      selection.kind === "step" &&
      !proposedDraft.steps.some((step) => step.stepId === selection.stepId)
    ) {
      setSelection({ kind: "form" });
    }
    mutate(proposedDraft);
  }

  return (
    <div className="flex flex-col gap-6">
      <SaveNotices paused={paused} saveError={saveError} />

      {/* Task 041 (ADR-25): the draft carries agent-assisted changes. Stated above every
          one of the builder's three screens rather than on the form's own, because it is a
          fact about the DRAFT being edited and the reader can be on any screen when they
          go to publish. */}
      {agentAssisted && (
        <div data-testid="qcms-builder-provenance">
          <AgentProvenanceTag />
        </div>
      )}

      {/* Task 041: the assist panel docks beside the builder as a complementary landmark,
          so the three screens below split into two columns only when the panel is actually
          present. With the flag off both wrappers are `display: contents`, which means a
          default deployment renders the identical box tree it did before this task: no
          grid, no extra column, and no assist affordance anywhere in the tree to find.

          `sidebar:`, and it has to be one of the two. `globals.css` clears Tailwind's own
          sm/md/lg/xl scale with `--breakpoint-*: initial`, so a `lg:` prefix does not
          compile at all - it is a dead class, not a narrower boundary, which is exactly
          what that block exists to prevent. Of the two the app does have, `--bp-sidebar`
          is the right one: it is where the rail becomes a permanent sidebar and the
          content column is at its widest, and a 22rem pane taken out of a `--bp-compact`
          (640px) column would leave the builder itself under 300px. Below it the panel
          stacks under the builder, full width, which is the phone-shaped reading of a
          docked pane. */}
      <div
        className={
          assist === undefined ? "contents" : "grid gap-4 sidebar:grid-cols-[minmax(0,1fr)_22rem]"
        }
      >
        <div className={assist === undefined ? "contents" : "flex flex-col gap-6"}>
          {/* TWO SCREENS BEHIND ONE ROUTE, and the rail is the switch (Code Owner, 2026-08-26).
            `plan/admin-shell-poc/admin-shell-poc.html` says so in its own card subtitle -
            "left rail navigating a form screen and a step screen" - and draws them, a Form
            screen of Form title, Form settings, Rules, Rule test bench and Validation, and a
            Step screen of that step's questions and nothing else.

            IT WAS THREE FOR TEN DAYS. The rules took a selection of their own on 2026-08-26
            because `plan/admin-ux-audit.md` §5.5 refused them a ROUTE - every rule-scoped
            validation anchor would resolve to nothing - and a selection let an issue entry
            switch screens and then focus. The Code Owner ruled on 2026-09-05 (issue #669)
            that `rules-screen-poc.html` is built as drawn instead, with the anchors rebuilt
            as route-plus-fragment links so that nothing resolves to nothing. So the rules
            are a route, this screen keeps the read-only lens above, and the two halves of
            that POC screen deliberately use different mechanisms: Validation stayed a
            selection (#659, built as #719) because its entries point at controls THIS screen
            renders. `plan/admin-design-contracts.md` §7 writes the pair up as one decision.

            It used to be ONE screen carrying everything, which meant the five FORM-level panels
            sat under whichever step was selected and followed the reader from step to step.
            Nothing was duplicated in the DOM, but the arrangement said the wrong thing: panels
            that belong to the form read as though each step had its own copy of them, and the
            only way to reach the form's settings was through a step that has nothing to do with
            them.

            The grid below is the builder's only responsive behaviour. `plan/admin-design-
            contracts.md` §1 fixes two boundaries and sorts side-by-side layouts between them;
            this is page content, so it keys to `--bp-compact`, which is what §1 assigns to
            ordinary side-by-side panes. Two of the three grids this comment used to describe
            are gone with the screens they laid out: rules no longer sit beside the validation
            panel, and the settings no longer sit beside the rule bench. The step list is not
            one of them either - it left this column for the rail on 2026-08-25, and
            `components/forms/rail-steps.tsx` is where it went. */}
          {selection.kind === "form" && (
            <>
              {/* WRAPPED, and the wrapper is load-bearing rather than layout. `formActions` is
                rendered by the SERVER and handed across the client boundary, which strips the
                marking React uses to tell a statically-written child from a dynamic one. As a
                bare member of this fragment's children array it therefore reads as a keyless
                list item, and React logs "Each child in a list should have a unique key" on
                every visit to the builder - which `e2e/support/gates.ts` fails the test for,
                correctly: a console error on a screen is a defect whether or not anything
                looks wrong. Being an only child, it is not in a list at all. */}
              {/* The heading, the two things you can do to the form, how it last saved, and
                what it is - in two rows, where it was five.

                `display: contents` on the heading's wrapper is load-bearing. The wrapper
                exists because a server-rendered node arriving across the client boundary
                reads to React as a keyless list item when it sits bare in a multi-child
                array, but the heading inside it is visually hidden and therefore out of
                flow, so the wrapper was an empty flex ITEM: zero wide, followed by the
                row's `gap-x-4`, indenting the buttons past the breadcrumb above them by
                16px. `contents` keeps the element and removes its box.

                `items-start` rather than baseline: the right column is two stacked lines
                now, and aligning its first baseline to a button's would hang it below the
                row it belongs to. */}
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {/* THE SCREEN'S NAME, and the same string the breadcrumb's last crumb uses -
                  one lookup, so a screen cannot answer to two names. Visually hidden because
                  the crumb directly above already says it; kept in the tree because a page
                  without a level-one heading is one a screen reader cannot navigate by.
                  `display: contents` on the wrapper: the heading is out of flow, and a
                  wrapper that generated a box would be an empty flex item indenting the
                  buttons past the breadcrumb. */}
                <div className="contents">
                  <h1 className="qcms-visually-hidden">{screenName}</h1>
                </div>
                <div>{formActions}</div>
                {/* What the form IS, above how it last saved: both are facts about the form
                  rather than actions on it, so they share the row's trailing edge and read
                  as one block rather than as chrome scattered across the header. */}
                <div className="flex flex-col items-end gap-1">
                  <div>{formMeta}</div>
                  {/* ONE STRIP FOR BOTH SAVES (Code Owner, 2026-08-29). The settings stopped
                    having a save model of their own, so they stopped having a save statement
                    of their own: a settings save is in flight here, and a settings save that
                    failed is a failed save here. §6's "exactly one save statement per screen"
                    is kept by the strip covering everything the screen stores, not by the
                    strip covering only some of it and a second sentence covering the rest. */}
                  <AmbientSaveStatus
                    isSaving={status === "saving" || settingsSaving}
                    hasFailed={saveError !== undefined || settingsError !== undefined}
                    savedAt={lastSavedAt}
                  />
                </div>
              </div>
              <FormNotices detail={detail} concurrentRead={concurrentNoticeRead} />
              <TextField
                label={t("forms.builder.formTitle")}
                description={t("forms.builder.formTitleHint")}
                value={textOf(draft.title, draft.defaultLocale)}
                onChange={(next) => {
                  mutate({ ...draft, title: { ...draft.title, [draft.defaultLocale]: next } });
                }}
              />

              {/* THE RULES, AS A COMPACT READ-ONLY LENS (Code Owner, 2026-09-05, issue
                #669), which is exactly what `plan/admin-shell-poc/admin-shell-poc.html`
                draws in this card: a digest, the sentences, and two ways through to the
                screen that edits them. Above the validation panel because the panel's
                rule-scoped entries point AT this route, and a reader meets the list before
                the complaints about it.

                Every one of its links carries `/forms/{formId}/rules` as well as its
                fragment. That is the ruling's mandatory constraint rather than a detail:
                a bare `#rule-x` fired from this screen would scroll to nothing now. */}
              <RulesLens draft={draft} library={library} issues={issues ?? []} />

              {/* VALIDATION STAYS HERE while the rules moved to a route of their own (Code
                Owner, 2026-08-26; reaffirmed 2026-09-05 by issue #669's ruling, which moved
                the other half). `plan/admin-ux-audit.md` §5.5 is emphatic that it should:
                "Validation is not a destination. It is a companion to editing and it has to be
                on the page whose controls it points at." Its entries are links that move focus
                to the offending rule, step or pin - a pin lives inside one step's editor on
                this route, and a rule lives on `/forms/{formId}/rules`. So what makes them
                work is `IssueEntry` switching first and focusing second: a step selection for
                the two that stay here, a ROUTE for the ones that left. #659 kept this panel a
                selection for exactly that reason, and #719 built it that way. */}
              <ValidationPanel draft={draft} issues={issues} warnings={warnings} status={status} />

              {/* ONE COLUMN (Code Owner, 2026-08-26). The settings shared a two-track grid with
                the rule test bench, and the bench has gone to the rules it tests, so there is
                nothing to sit beside. A lone panel in a two-column grid is a column of
                whitespace. */}
              <FormSettingsPanel
                settings={settings}
                challengeEnforceable={detail.challengeEnforceable}
                saveError={settingsError}
                onChange={setSettings}
              />
            </>
          )}
          {selection.kind === "step" && (
            <div>
              {/* Nothing rather than a second copy of the rail's own empty-state sentence: a
                step editor with no step is exactly the state the rail is already explaining,
                and saying it twice reads as two different facts. */}
              {selectedStep === undefined ? null : (
                <StepEditor
                  draft={draft}
                  step={selectedStep}
                  saveFlash={<AutosaveFlash savedAt={lastSavedAt} />}
                  library={library}
                  issues={issues}
                  /* One `mutate` for the whole batch, folded left over the pins.
                 `addPinAt` is pure and returns the next draft, so the fold is what makes a
                 multi-pin add correct: calling this handler once per pin would hand
                 `addPinAt` the SAME closed-over `draft` every time and keep only the last
                 result. Folding also makes the batch one entry in the draft's history, which
                 is what it is to the author: one press of one button.
                 The boundary advances with each pin so the batch lands in the order it was
                 chosen, rather than every pin insetting at `index` and arriving reversed. */
                  onAddPins={(pins, index) => {
                    mutate(
                      pins.reduce(
                        (next, pin, offset) =>
                          addPinAt(
                            next,
                            selectedStep.stepId,
                            pin.questionId,
                            pin.version,
                            index + offset,
                          ),
                        draft,
                      ),
                    );
                  }}
                  onMovePin={(questionId, version) => {
                    mutate(movePin(draft, questionId, version));
                  }}
                  onRemovePin={(questionId) => {
                    mutate(removePin(draft, questionId));
                  }}
                  onReorderPin={(questionId, delta) => {
                    mutate(movePinWithinStep(draft, selectedStep.stepId, questionId, delta));
                  }}
                />
              )}
            </div>
          )}
        </div>

        {assist !== undefined && (
          <AssistPanel
            endpoint={assist.endpoint}
            draft={draft}
            draftUpdatedAt={draftUpdatedAt}
            onAccept={acceptAssistProposal}
          />
        )}
      </div>
    </div>
  );
}

/** The standing notices: where this draft came from, and what autosave is doing. */
/**
 * The three standing facts about the FORM: it was seeded, it is closed, someone else may
 * be editing it. Said once, on the form's own screen (Code Owner, 2026-08-26).
 *
 * They used to stand above the whole builder, so every step screen repeated all three -
 * three information alerts above a step's questions, none of which are about that step and
 * none of which change while the reader works. Saying a standing fact once, where the
 * subject of the fact lives, is the whole of it.
 *
 * The save notices below are deliberately NOT here: see the note on {@link SaveNotices}.
 */
function FormNotices({
  detail,
  concurrentRead,
}: {
  readonly detail: FormDetail;
  readonly concurrentRead: boolean;
}) {
  // The dismissal lives HERE rather than inside the notice it hides, so that this
  // component can know whether it has anything at all to say. It did not, and rendered an
  // empty box for a form with nothing to report: in a `gap-6` column a zero-height child
  // still takes a whole gap slot, so the screen sat 48px below its header where 24px was
  // meant. The same defect the save notices had, in the same column, found the same way -
  // by measuring rather than by looking.
  const [dismissed, setDismissed] = useState(concurrentRead);
  const seeded = detail.draftSource === "seeded";
  const closed = detail.status === "closed";
  if (!seeded && !closed && dismissed) return null;

  return (
    <div className="flex flex-col gap-2">
      {seeded && <Alert variant="info">{t("forms.builder.seeded")}</Alert>}
      {closed && <Alert variant="info">{t("forms.builder.closed")}</Alert>}
      {!dismissed && (
        <ConcurrentNotice
          onDismiss={() => {
            setDismissed(true);
          }}
        />
      )}
    </div>
  );
}

/**
 * The concurrent-edit warning: said in full once, then dismissed for good (Code Owner,
 * 2026-08-26).
 *
 * It is a standing fact about how this app saves - there is no locking, and the last save
 * wins - so it never changes and it was permanently occupying four lines above every form.
 * A warning nobody can stop reading is one everybody stops reading.
 *
 * WHAT THIS TRADE COSTS, stated rather than buried: an operator who dismisses it on their
 * machine never sees it again, and a colleague joining the team later sees it on theirs
 * only until they dismiss it too. The warning is about coordinating with other authors, so
 * the person who most needs it is the one who has been here long enough to have dismissed
 * it. `docs/operations.md` is where it stays permanently true; this is the prompt, not the
 * documentation.
 *
 * The state arrives from the server on the request's own cookie rather than being read here
 * after mount, which is what keeps the screen right in its first byte instead of pushing
 * itself down a frame later - see `lib/builder-notice.ts`.
 */
function ConcurrentNotice({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <Alert variant="info">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span>{t("forms.builder.concurrent")}</span>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            // Written from the browser rather than through a server action: it is a
            // preference nothing depends on, and a round trip to record "this person has
            // read a sentence" would be the heavier half of the feature. A refused write
            // (a browser blocking cookies) still hides it for this visit, which is the
            // behaviour the press asked for.
            try {
              document.cookie = concurrentNoticeCookie(window.location.protocol === "https:");
            } catch {
              // Ignored on purpose: see above.
            }
            onDismiss();
          }}
        >
          {t("forms.builder.concurrentDismiss")}
        </Button>
      </div>
    </Alert>
  );
}
