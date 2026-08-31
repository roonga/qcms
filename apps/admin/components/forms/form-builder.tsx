"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { AmbientSaveStatus, AutosaveFlash } from "@/components/save-model";
import type {
  PreviewConditionState,
  SaveDraftState,
  SettingsState,
  ValidateDraftState,
} from "@/lib/forms/builder-state";
import {
  addPinAt,
  addStep,
  blankDraft,
  movePin,
  movePinWithinStep,
  moveStep,
  removePin,
  removeRule,
  newRule,
  removeStep,
  renameStep,
  unsaveableReason,
  upsertRule,
  type UnsaveableReason,
} from "@/lib/forms/draft";
import { ruleAnchorId, stepAnchorId, stepIssueCounts } from "@/lib/forms/issues";
import { hasSettingsChange, settingsPatch } from "@/lib/forms/settings";
import type {
  DraftForm,
  DraftRule,
  FormDetail,
  FormIssue,
  FormSettings,
  PinnableQuestion,
} from "@/lib/forms/types";
import { t, type MessageKey } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { FormSettingsPanel } from "./form-settings-panel";
import { RuleTestBenchPanel } from "./rule-test-bench";
import { RuleWizard } from "./rule-wizard";
import { RulesTable } from "./rules-table";
import { concurrentNoticeCookie } from "@/lib/builder-notice";
import { currentScreenName } from "./builder-breadcrumb";
import { usePublishBuilderRail, type BuilderSelection } from "@/lib/forms/builder-bridge";
import { StepEditor } from "./step-editor";
import { ValidationPanel, type BuilderStatus } from "./validation-panel";

/**
 * The form builder (task 033; screen contract `admin-form-builder.md`).
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
 * ## Autosave is advisory (022)
 *
 * A draft with issues saves perfectly well and comes back with the list of what would block
 * a publish, so the panel showing twelve issues beside "Saved 12:03" is the normal case
 * rather than a contradiction. Two states cannot be saved at all, because `FormDefinition`
 * requires at least one step and at least one pin per step: those pause autosave and say
 * why, instead of throwing a red error every few seconds while the first step is being
 * built.
 *
 * ## Why the round trip is two calls
 *
 * `PUT .../draft` stores and returns issues; `POST .../draft/validate` re-runs the same
 * compile without storing. The builder does both on one debounce because they answer
 * different questions and the second is the one exit criterion 2 turns on: the kernel's
 * `analyzeRuleGraph` runs inside that compile, so `RULE_BACKWARD_TARGET` arrives from the
 * engine itself rather than from a second implementation of the analysis in this app (there
 * could not be one - the admin takes no `@qcms/core` value import). The *instant* flag an
 * author sees the moment they pick a backward target is a different mechanism entirely:
 * `eligibleTargets`, pure draft geometry, inside the condition editor.
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

/** How long the builder waits after the last keystroke before it talks to the API. */
const AUTOSAVE_DEBOUNCE_MS = 600;

export function FormBuilder({
  detail,
  library,
  formActions,
  formMeta,
  concurrentNoticeRead,
  saveDraft,
  validateDraft,
  updateSettings,
  previewCondition,
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
   * server's own read of the form, and the builder only decides which of its three screens
   * it belongs on - the form's own details, the rules, or one step. The `<h1>` travelling
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
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly updateSettings: (patch: {
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  }) => Promise<SettingsState>;
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  // `undefined`, not `[]`. Nothing has validated this draft when the screen opens, and a
  // seeded empty list is an initial value that the panel and the pin grid used to render
  // as a verdict: "No issues. Everything here would pass a publish." beside the Publish
  // button, on a form whose stored draft may be full of them (issue 625). The effect below
  // does not fire until the author changes something, so this stays `undefined` for as long
  // as the screen genuinely knows nothing, and the surfaces that read it say so.
  const [issues, setIssues] = useState<readonly FormIssue[] | undefined>(undefined);
  const [status, setStatus] = useState<BuilderStatus>("idle");
  // An ISO instant, not a formatted clock time. The strip renders it through the app's one
  // timestamp formatter (`plan/admin-design-contracts.md` §2: date, HH:MM, zone, no
  // seconds) and exposes the raw instant as `data-saved-at`, so the sentence a person hears
  // can be low-churn while a test can still tell two saves apart. Issue 518.
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
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

  // Whether the author has touched anything this visit. Without it the first render would
  // post the draft straight back, which would store a `seeded` draft nobody edited.
  const isDirty = useRef(false);
  const mutate = (next: DraftForm) => {
    isDirty.current = true;
    setDraft(next);
  };

  // The three actions live in a ref, and that is not a style choice. They arrive already
  // bound to this route's form id, so the page hands down a NEW function identity on every
  // server render - and a successful save calls `revalidatePath`, which causes one. An
  // effect that depended on them would therefore re-arm its debounce because it had just
  // saved, save again, revalidate again, and never stop. Reading them through a ref keeps
  // the effect's inputs what they actually are: the draft, and whether it can be stored.
  //
  // `updateSettings` joined them on 2026-08-29 and it is the same trap, not a similar one:
  // `updateSettingsAction` revalidates this exact path too, so a settings autosave that
  // depended on the prop would be the same loop with a different action in it.
  const actions = useRef({ saveDraft, validateDraft, updateSettings });
  actions.current = { saveDraft, validateDraft, updateSettings };

  const paused = unsaveableReason(draft);
  // The one name for the screen being shown, shared with the breadcrumb so the two cannot
  // drift. `currentScreenName` takes the published snapshot rather than the selection,
  // because that is what the crumb outside this tree can also read.
  const screenName = currentScreenName(selection, draft.steps);

  useEffect(() => {
    if (!isDirty.current || paused !== undefined) return undefined;
    setStatus("saving");
    const timer = setTimeout(() => {
      void (async () => {
        const saved = await actions.current.saveDraft(draft);
        if (saved.status === "error") {
          // The verdict is left exactly as it was, which on a first save means still
          // absent. `saved.issues` is the empty list a failed read supplies, and writing
          // it here would turn a store failure into a fabricated all-clear one layer
          // below the panel - the same trap the validate leg avoids below (issue 625).
          setSaveError(saved.message);
          setStatus("error");
          return;
        }
        setIssues(saved.issues);
        setSaveError(undefined);
        setLastSavedAt(new Date().toISOString());
        setStatus("validating");
        // The second round trip is the one the screen contract calls live validation. It does not
        // store, and it is where `RULE_BACKWARD_TARGET` and `RULE_CYCLE` come from: the
        // kernel's `analyzeRuleGraph` runs inside the same compile.
        const validated = await actions.current.validateDraft(draft);
        if (validated.status === "error") {
          // Keep whatever the store leg just returned rather than overwriting it with the
          // empty list a failed read supplies. `PUT .../draft` returns issues too, so the
          // number on screen is a real one computed moments ago; replacing it with zero
          // would turn a refresh failure into a fabricated all-clear. The panel says the
          // count could not be refreshed, which is only honest if there is still a count.
          setStatus("error");
          return;
        }
        setIssues(validated.issues);
        setStatus("saved");
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, paused]);

  // The settings, on the same debounce and deliberately the same shape as the effect above
  // (Code Owner, 2026-08-29). One save model on this screen means one way of saving, so
  // this is the draft's loop with the second round trip removed: settings have no issues
  // to validate and no `paused` state, because there is no such thing as a settings pair
  // that cannot be stored.
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
        const result = await actions.current.updateSettings(patch);
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
        setLastSavedAt(new Date().toISOString());
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
    // The rules row on the other seven screens is a LINK to this one carrying `#rules`,
    // because there is no draft in that tree to select in. This is the other half of it.
    if (window.location.hash === "#rules") {
      setSelection({ kind: "rules" });
      return;
    }

    // A rule's anchor, for the same reason: `/forms/{id}#rule-{ruleId}` is what a publish
    // rejection's work list links to, and landing on it used to show the form's details.
    const rulePrefix = `#${ruleAnchorId("")}`;
    if (window.location.hash.startsWith(rulePrefix)) {
      const ruleId = window.location.hash.slice(rulePrefix.length);
      if (draft.rules.some((rule) => rule.ruleId === ruleId)) {
        setSelection({ kind: "rules" });
        return;
      }
    }

    const prefix = `#${stepAnchorId("")}`;
    const hash = window.location.hash;
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
        chooseRules: () => {
          setSelection({ kind: "rules" });
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

  return (
    <div className="flex flex-col gap-6">
      <SaveNotices paused={paused} saveError={saveError} />

      {/* THREE SCREENS BEHIND ONE ROUTE, and the rail is the switch (Code Owner, 2026-08-26).
          It was two: `plan/admin-shell-poc/admin-shell-poc.html` says so in its own card
          subtitle - "left rail navigating a form screen and a step screen" - and draws them,
          a Form screen of Form title, Form settings, Rules, Rule test bench and Validation,
          and a Step screen of that step's questions and nothing else. The RULES then took a
          screen of their own, drawn by `rules-screen-poc.html` as a full-width editor: a
          condition editor is the widest thing this app builds, and it shared a row with the
          validation panel only because everything form-level was crowded onto one screen.

          A SELECTION, not a route, and `lib/forms/builder-bridge.ts` records why that
          distinction is what made the third screen safe: `plan/admin-ux-audit.md` §5.5
          refused a rules ROUTE because every rule-scoped validation anchor would resolve to
          nothing, and a selection lets an issue entry switch screens and then focus.

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

          {/* VALIDATION STAYS HERE while the rules move to a screen of their own (Code
              Owner, 2026-08-26). `plan/admin-ux-audit.md` §5.5 is emphatic that it should:
              "Validation is not a destination. It is a companion to editing and it has to be
              on the page whose controls it points at." Its entries are links that move focus
              to the offending rule, step or pin, and those now live on three different
              screens - so what makes them work is `IssueEntry` switching screens before it
              focuses, not the panel sitting beside any one of them. */}
          <ValidationPanel draft={draft} issues={issues} status={status} />

          {/* ONE COLUMN (Code Owner, 2026-08-26). The settings shared a two-track grid with
              the rule test bench, and the bench has gone to the rules it tests, so there is
              nothing to sit beside. A lone panel in a two-column grid is a column of
              whitespace. */}
          <FormSettingsPanel
            settings={settings}
            challengeProvider={detail.challengeProvider}
            saveError={settingsError}
            onChange={setSettings}
          />
        </>
      )}
      {selection.kind === "rules" && (
        /* THE RULES, ON A SCREEN OF THEIR OWN (Code Owner, 2026-08-26), which
           `plan/admin-shell-poc/rules-screen-poc.html` draws as a full-width editor and
           heads "Rules". Full width here too: it shared the row with the validation panel
           only because both were crowded onto one screen, and a rule's condition editor is
           the widest thing this app builds.

           TWO BENCHES, AND NEITHER IS THE OTHER (Code Owner, 2026-08-30). The screen's
           stays under this table, expanded, with its Select over the form's rules: it
           answers "the form has these rules - what does that one do", which is a question
           asked while READING the table, about rules as they are stored. The wizard's
           third phase is the other one, about the single rule being edited and against the
           draft the dialog is buffering, so it answers about an edit that has not been
           saved yet. One tests the form; the other tests the change.

           The settings stay on the form's screen. */
        <RulesSection
          draft={draft}
          library={library}
          issues={issues ?? []}
          previewCondition={previewCondition}
          onChange={mutate}
        />
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
  );
}

/**
 * Why autosave is paused, in the author's words.
 *
 * A table rather than a chain of ternaries so that adding a fourth unsaveable state is a
 * compile error here until it has a sentence: `Record<UnsaveableReason, MessageKey>` is
 * exhaustive by construction.
 */
const PAUSE_MESSAGES: Readonly<Record<UnsaveableReason, MessageKey>> = {
  noSteps: "forms.save.pausedNoSteps",
  emptyStep: "forms.save.pausedEmptyStep",
  ruleWithoutTarget: "forms.save.pausedNoTarget",
};

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

/**
 * Autosave paused, and a save that failed. These stay above the screen split, on every
 * screen, and that is the point rather than an oversight.
 *
 * The three above are standing facts about the form, and a reader who has read them once
 * has read them. These two are about the save happening right now, and the work at risk
 * when they appear is usually the step the reader is editing: hiding "this draft is not
 * being saved" behind a screen switch would hide it exactly when it matters most. They
 * appear rarely and clear themselves, so they cost the step screen nothing when quiet.
 */
function SaveNotices({
  paused,
  saveError,
}: {
  readonly paused: UnsaveableReason | undefined;
  readonly saveError: string | undefined;
}) {
  // NOTHING, not an empty box. The builder's column is a `gap-6` flex stack, so a wrapper
  // that renders with zero height still consumes a whole gap slot: on the step screen that
  // put 48px between the breadcrumb and the step's card where 24px was intended, and the
  // empty div doing it was invisible in the picture and in the DOM inspector alike.
  if (paused === undefined && saveError === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      {paused !== undefined && (
        <div data-testid="qcms-autosave-paused" data-paused-reason={paused}>
          <Alert variant="warning">{t(PAUSE_MESSAGES[paused])}</Alert>
        </div>
      )}
      {saveError !== undefined && (
        <Alert variant="error">{t("forms.builder.saveFailed", { message: saveError })}</Alert>
      )}
    </div>
  );
}

/**
 * Every rule of the draft, plus the control that adds one and the wizard that edits one.
 *
 * THE RULE BEING EDITED IS HELD BY VALUE HERE, which is the reverse of what this held
 * before 2026-08-30 and is the buffering directly. It used to hold an ID and look the rule
 * up on every render, because the draft was replaced on every keystroke inside the dialog
 * and a held object would have gone stale immediately. The dialog no longer writes to the
 * draft at all, so the object is now the only copy there is, and looking one up by id
 * could not work for an ADD - a rule being added is not in the draft to be found.
 *
 * `RuleWizard` seeds its own buffer from this and hands it back on Save.
 */
function RulesSection({
  draft,
  library,
  issues,
  previewCondition,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
  readonly onChange: (next: DraftForm) => void;
}) {
  // A condition has to read a question, so there is nothing to add a rule against until
  // the form pins one. The button says why rather than being silently inert.
  const firstPinned = draft.steps.flatMap((step) => step.items)[0]?.questionId;
  const [edited, setEdited] = useState<DraftRule | undefined>(undefined);

  return (
    <section
      aria-labelledby="qcms-rules-heading"
      // NO BOX (Code Owner, 2026-08-29). The border and padding made sense when the rules
      // were one panel among five on the form's screen and something had to say where they
      // began. They are the whole of their own screen now, so the frame was a box drawn
      // around everything - and the table inside it already has its own edges.
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* AN `h1`, because on the rules screen this IS the screen's subject - the same
            call the step screen's heading makes, and for the same reason: the form's own
            heading is on the form's screen, so without this the rules screen would have no
            level-one heading at all. `e2e/a11y-axe.pw.ts` sweeps for exactly that.

            Not painted: the breadcrumb directly above ends in "Rules", so a visible copy
            tells a sighted reader what they have just read. It stays in the tree because
            the section is `aria-labelledby` it, and a region announced as "Rules" is how a
            screen reader knows which of the three screens it is in. */}
        <h1 id="qcms-rules-heading" className="qcms-visually-hidden">
          {t("forms.rules.title")}
        </h1>
        <Button
          variant="secondary"
          size="md"
          isDisabled={firstPinned === undefined}
          onPress={() => {
            // MINTED, NOT ADDED. The rule reaches the draft when Save is pressed and not
            // before, so cancelling out of a rule you have just started leaves nothing
            // behind - and no targetless rule is left to pause the screen's autosave
            // (`unsaveableReason`'s third case).
            if (firstPinned !== undefined) setEdited(newRule(draft, firstPinned));
          }}
        >
          {t("forms.rules.add")}
        </Button>
      </div>

      {firstPinned === undefined && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.needPin")}</p>
      )}

      {draft.rules.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.empty")}</p>
      ) : (
        <RulesTable
          draft={draft}
          library={library}
          issues={issues}
          onEdit={(ruleId) => {
            setEdited(draft.rules.find((rule) => rule.ruleId === ruleId));
          }}
          onRemove={(ruleId) => {
            onChange(removeRule(draft, ruleId));
          }}
        />
      )}

      {/* THE EDITOR IS A THREE-PHASE WIZARD IN A WIDE DIALOG (Code Owner, 2026-08-30), and
          the table above is still the read view (Code Owner, 2026-08-26).

          CANCEL AND SAVE, which means this buffers: `RuleWizard` holds the rule and only
          what comes back through `onSave` reaches the draft. `plan/admin-design-contracts.md`
          §6's 2026-08-30 amendment is the ruling and states the cost - while the dialog is
          open the screen's autosave has nothing to save, so a long edit is unsaved work.

          `key` is the rule id, so opening a different rule REMOUNTS the wizard and its
          buffer is seeded afresh. Without it React would keep the state of the previous
          rule's dialog, and the second rule an author opened would be shown the first
          one's edits. */}
      {/* THE SCREEN'S BENCH, EXPANDED (Code Owner, 2026-08-29, restored 2026-08-30). Under
          the rules it tests, because it reads `draft.rules` and answers "what would this
          rule do", which is a question you ask while looking at the rule. It takes the
          STORED rules: the wizard's copy is the one that sees an edit in progress. */}
      <RuleTestBenchPanel
        draft={draft}
        rules={draft.rules}
        library={library}
        previewCondition={previewCondition}
      />

      {edited !== undefined && (
        <RuleWizard
          key={edited.ruleId}
          draft={draft}
          rule={edited}
          library={library}
          issues={issues}
          previewCondition={previewCondition}
          onSave={(next) => {
            onChange(upsertRule(draft, next));
            setEdited(undefined);
          }}
          onCancel={() => {
            setEdited(undefined);
          }}
        />
      )}
    </section>
  );
}
