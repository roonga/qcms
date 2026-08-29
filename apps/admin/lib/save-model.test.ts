import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The app-wide save-model property (issue 518; `plan/admin-design-contracts.md` §6).
 *
 * The acceptance criterion this pins is not a property of the two screens issue 518
 * changed: it is "**no screen in the app shows two different save-state statements**",
 * which is a property of the whole admin. A Playwright spec can only assert it on the
 * screens it happens to visit, and the failure mode is a screen nobody thought to visit -
 * an author who has learned that the builder saves itself assumes the next editor does
 * too, and the cost of being wrong is work silently thrown away.
 *
 * So this is a source-level test, and it is deliberately the boring kind: an inventory of
 * every route in the app with its save model, plus the checks that keep the inventory
 * honest. Adding a screen fails this file until someone writes down how it saves, which is
 * the only mechanism that survives the people who know the rule leaving.
 *
 * ADR-23 puts behaviour in Playwright and this does not contradict that: what the two
 * changed screens *do* is asserted in the browser (`apps/admin/e2e/save-model.pw.ts`).
 * What no test can assert in a browser is the absence of a fourth variant on a screen the
 * suite never opens, and that is this file's whole job.
 *
 * ## The exception that used to be here, and how it was closed
 *
 * The form builder screen embeds `FormSettingsPanel`, and that panel used to persist
 * itself: an explicit Save button and a "Settings saved." live region beside a screen that
 * autosaves everything else. Contract §6 addressed screens rather than nested scopes, so
 * issue 518 recorded the collision instead of deciding it, PR #585 escalated it, and the
 * 2026-08-21 amendment ruled the second model legitimate while naming what it cost: press
 * the button and the screen said "Saved <time>" and "Settings saved." at once.
 *
 * The 2026-08-29 amendment closed it by removing the second model rather than rewording
 * it. The settings autosave on the builder's own debounce and feed the builder's own
 * ambient strip, so the builder route is `autosave` for everything it stores and the
 * inventory row below needs no footnote.
 *
 * `forms.settings.failed` stays in `SAVE_STATE_KEYS` and the panel stays in the carrier
 * list. That is not a leftover exception: a refused write still has to be stated, and
 * keeping the sentence enumerated is what makes a future "Settings saved." coming back
 * fail this file rather than pass it unseen.
 */

/**
 * How a screen persists what an author does on it.
 *
 * The line between `manual` and `action` is the one worth stating, because it is the line
 * contract §6 turns on: `manual` means the screen holds **accumulated authored state that a
 * navigation would silently discard**, so it owes the author a statement of when that state
 * is stored. `action` means the controls perform discrete operations (create, revoke,
 * publish, sign in) with nothing accumulating behind them - there is no unsaved work to
 * lose, so §6's "read-only screens say nothing" reasoning applies to them too.
 */
type SaveModel = "autosave" | "manual" | "action" | "readonly";

interface ScreenRow {
  /** Path of the route's `page.tsx`, relative to `apps/admin`. */
  readonly route: string;
  readonly model: SaveModel;
  /**
   * For a `manual` screen, the component that must carry the manual-model statement,
   * relative to `apps/admin`. `undefined` for every other model.
   */
  readonly statedBy?: string;
  /** Why this row reads the way it does, for whoever changes the screen next. */
  readonly why: string;
}

const QUESTION_EDITOR = "components/questions/question-editor.tsx";

/**
 * Every authenticated and unauthenticated screen in the admin, with its save model.
 *
 * Swept screen by screen for issue 518 rather than inferred from the two files the issue
 * named. The verdicts are about what the screen *does*, not about what it says: the third
 * column is the fix, and before 518 three of these rows said nothing at all.
 */
const SCREENS: readonly ScreenRow[] = [
  {
    route: "app/page.tsx",
    model: "readonly",
    why: "A redirect to /forms. It renders nothing.",
  },
  {
    route: "app/sign-in/page.tsx",
    model: "action",
    why: "Credentials submitted once. Nothing is authored and nothing accumulates.",
  },
  {
    route: "app/two-factor/challenge/page.tsx",
    model: "action",
    why: "A one-shot code entry.",
  },
  {
    route: "app/two-factor/enroll/page.tsx",
    model: "action",
    why: "A one-shot enrollment confirmation.",
  },
  {
    route: "app/two-factor/recovery-codes/page.tsx",
    model: "action",
    why: "Displays codes and takes an attestation ('I have saved these codes'), which is about the author's own copy, not about this app storing anything.",
  },
  {
    route: "app/two-factor/recovery/page.tsx",
    model: "action",
    why: "A one-shot code redemption.",
  },
  {
    // Was `action`, and its `why` named the fieldset as the reason. Issue 685 moved that
    // fieldset to `/forms/new`, so this screen keeps nothing an author could type into it
    // and drops to `readonly` - the row below is where the create model now lives.
    route: "app/(shell)/forms/page.tsx",
    model: "readonly",
    why: "A listing with a link to the creating screen. Nothing on it is authored.",
  },
  {
    route: "app/(shell)/forms/new/page.tsx",
    model: "action",
    why: "The slug, title and locale fields that create a form and navigate to its builder. Nothing accumulates, so there is no unsaved work a statement would protect. NOT `manual` for the same reason `/questions/new` is: that screen holds a whole authored document, this one holds an identity being named.",
  },
  {
    route: "app/(shell)/forms/[formId]/page.tsx",
    model: "autosave",
    why: "The one autosaving screen in the app: a 600ms debounce over the whole draft, and since 2026-08-29 the same debounce over the form's settings. Carries the ambient strip (design-language element 7), which is now the only save statement on it.",
  },
  {
    route: "app/(shell)/forms/[formId]/preview/page.tsx",
    model: "readonly",
    why: "Renders the draft for inspection; its own copy already says nothing here is saved.",
  },
  // The eight `@rail` entries below are parallel-route slots rather than screens (issue
  // 559 wired the first, issue 561 the rest): each renders one form's section of the rail
  // beside `<main>` on a route some form page already owns. They are listed rather than filtered out because
  // the value of this inventory is that a new `page.tsx` forces someone to write down how
  // it saves, and a slot that grew a control would need that question asked of it exactly
  // as a screen would. All eight answer the same way, and that is the contract rather than
  // a coincidence: §7 gives the rail no actions at all.
  {
    route: "app/(shell)/@rail/forms/[formId]/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/preview/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/versions/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/versions/[version]/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/links/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/responses/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/responses/[sessionId]/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/webhooks/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    // The ninth slot page, and behind a different contract (issue 562): §7a's Settings rail
    // carries same-page section switches rather than routes. The save answer is the same for
    // the same reason, and that reason - this rail carries no actions - is the whole of what
    // the two contracts have in common here.
    route: "app/(shell)/@rail/settings/page.tsx",
    model: "readonly",
    why: "Navigation only. §7a gives the Settings rail no actions and no counts, so there is nothing on it to save.",
  },
  {
    // The tenth slot page, and the first rail in the app that carries controls (issue 650).
    // Its POC (`plan/admin-shell-poc/question-editor-poc.html`) draws the three lifecycle
    // buttons pinned above the version list, so this row is `action` where the other nine
    // are `readonly`. What it is NOT is `manual`: publish, deprecate and new-version are
    // discrete confirmed operations with nothing accumulating behind them, so there is no
    // unsaved work here for a navigation to discard. The authored document is next door in
    // the content column, and that column's row below is the one that owes the statement.
    route: "app/(shell)/@rail/questions/[questionId]/page.tsx",
    model: "action",
    why: "Publish, deprecate and new version, each a discrete confirmed operation that reports its own outcome inside its dialog. The version rows beside them are navigation.",
  },
  // The seven `@rail` entries below are the routes that have a rail and contribute no
  // section to it (Code Owner decision, 2026-08-23). They exist because a slot page that
  // renders nothing is not the same as no slot page at all: Next keeps a slot's previously
  // active state across a soft navigation the new URL does not match, so a route with no
  // page here inherited the LAST screen's section rather than an empty rail. They are
  // listed for the reason the ten above are: a new `page.tsx` should force the question.
  {
    route: "app/(shell)/@rail/forms/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/new/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/questions/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/questions/new/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/responses/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/responses/erasures/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/webhooks/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/forms/[formId]/links/page.tsx",
    model: "action",
    why: "Mint and revoke. Its live region reports the outcome of a completed action, not a save state.",
  },
  {
    route: "app/(shell)/forms/[formId]/responses/page.tsx",
    model: "readonly",
    why: "Browse, filter and export. Nothing is authored.",
  },
  {
    route: "app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx",
    model: "action",
    why: "Erase and unflag, announced through the shell announcer as completed actions.",
  },
  {
    route: "app/(shell)/forms/[formId]/versions/page.tsx",
    model: "readonly",
    why: "A list of immutable published versions (R1).",
  },
  {
    route: "app/(shell)/forms/[formId]/versions/[version]/page.tsx",
    model: "readonly",
    why: "One immutable version. Its content can never change again.",
  },
  {
    route: "app/(shell)/forms/[formId]/webhooks/page.tsx",
    model: "action",
    why: "Add, retarget, rotate, activate. Each is a discrete confirmed operation with its own outcome region.",
  },
  {
    route: "app/(shell)/questions/page.tsx",
    model: "readonly",
    why: "A searchable library listing.",
  },
  {
    route: "app/(shell)/questions/new/page.tsx",
    model: "manual",
    statedBy: QUESTION_EDITOR,
    why: "The question editor in create mode: a whole document held on screen and stored only by pressing Create draft. This is the screen an author reaches after learning the builder autosaves.",
  },
  {
    route: "app/(shell)/questions/[questionId]/page.tsx",
    model: "manual",
    statedBy: QUESTION_EDITOR,
    why: "The question editor in edit mode. Same document, same explicit press. The lifecycle actions moved to this screen's rail in issue 650 and are inventoried on that slot's own row; they are discrete operations and report no save state either way.",
  },
  {
    route: "app/(shell)/responses/page.tsx",
    model: "readonly",
    why: "An index of per-form response browsers.",
  },
  {
    route: "app/(shell)/responses/erasures/page.tsx",
    model: "readonly",
    why: "The erasure audit list.",
  },
  {
    route: "app/(shell)/settings/page.tsx",
    model: "action",
    why: "Change password and regenerate recovery codes. Both are credential operations reported as outcomes ('Your password was changed...'), not as a save state, and neither leaves unsaved work behind.",
  },
  {
    route: "app/(shell)/webhooks/page.tsx",
    model: "action",
    why: "Redeliver and redeliver-all over dead letters.",
  },
];

/**
 * `apps/admin`, resolved from this file rather than from the process cwd.
 *
 * Vitest runs this project with `--root <repo>`, so the cwd is the repo root here and
 * `apps/admin` when turbo runs the same script from the package. Deriving the root from
 * `import.meta.url` is what makes the two agree.
 */
const APP_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(APP_ROOT, relative), "utf8");
}

/** Every file under one of `apps/admin`'s directories, as paths relative to `apps/admin`. */
function filesUnder(top: string, keep: (name: string) => boolean): readonly string[] {
  return readdirSync(join(APP_ROOT, top), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => relative(APP_ROOT, join(entry.parentPath, entry.name)))
    .sort((left, right) => left.localeCompare(right));
}

/** Every `page.tsx` under `app/`: one per screen, which is what makes it the screen list. */
function routeFiles(): readonly string[] {
  return filesUnder("app", (name) => name === "page.tsx");
}

/**
 * Every module that can put something on a screen.
 *
 * Test files are excluded, and that is not a convenience. A test that asserts a sentence
 * is ABSENT quotes the same key as the component that renders it, so counting test files
 * as carriers would make an assertion against the rule read as a violation of it. That is
 * not hypothetical: `components/forms/builder-digests.test.tsx` checks that the settings
 * digest does not repeat "Settings saved.", which is the rule being kept, not broken.
 */
function uiSources(): readonly string[] {
  const tsx = (name: string): boolean => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name);
  return [...filesUnder("app", tsx), ...filesUnder("components", tsx)];
}

/**
 * The message keys that state a save STATE (as opposed to the outcome of one action the
 * author just took). These are what a screen may carry at most one set of.
 *
 * Enumerated by hand rather than by prefix, and the last one is why. `forms.save.*` is a
 * naming convention; "states a save state" is a rule about meaning, and a prefix filter
 * polices the first while claiming to police the second. `forms.settings.failed` is a
 * second save-state vocabulary minted under a different prefix, and a filter that could
 * not see it would report the property green on a screen that visibly breaks it. Anything
 * added here that names when work is or is not stored belongs on this list whatever it is
 * called.
 *
 * `forms.settings.saved` was on this list until 2026-08-29 and is not merely off it: the
 * key is gone from the catalog, because the settings stopped having a save model to
 * confirm. A key that no longer exists cannot be enumerated, so what guards against it
 * returning is the carrier assertion below plus the panel's own tests.
 */
const SAVE_STATE_KEYS = [
  "forms.save.model",
  "forms.save.idle",
  "forms.save.saving",
  "forms.save.saved",
  "forms.save.failed",
  "forms.settings.failed",
] as const;

describe("the admin's save models are inventoried", () => {
  it("classifies every route in the app exactly once", () => {
    const listed = SCREENS.map((screen) => screen.route).sort((left, right) =>
      left.localeCompare(right),
    );
    expect(new Set(listed).size, "no route is listed twice").toBe(listed.length);
    expect(listed).toStrictEqual([...routeFiles()]);
  });

  it("gives every screen a reason, and only manual screens a component that states it", () => {
    for (const screen of SCREENS) {
      expect(screen.why.length, `${screen.route} needs a reason`).toBeGreaterThan(20);
      if (screen.model === "manual") {
        expect(screen.statedBy, `${screen.route} is manual and must name its statement`).toBeTypeOf(
          "string",
        );
      } else {
        expect(
          screen.statedBy,
          `${screen.route} is not manual and must not name one`,
        ).toBeUndefined();
      }
    }
  });

  it("has exactly one autosaving screen, which is the one that carries the ambient strip", () => {
    const autosaving = SCREENS.filter((screen) => screen.model === "autosave");
    expect(autosaving.map((screen) => screen.route)).toStrictEqual([
      "app/(shell)/forms/[formId]/page.tsx",
    ]);
  });
});

describe("no screen shows two different save-state statements", () => {
  it("keeps every save-state sentence in the one module, plus the settings' own refusal", () => {
    const carriers = uiSources().filter((file) =>
      SAVE_STATE_KEYS.some((key) => source(file).includes(`"${key}"`)),
    );
    // Two entries, and this list is where contract §6's resolution of the nested scope
    // shows up (see the note at the top of this file). `FormSettingsPanel` is still one of
    // them because a settings save that FAILED is still stated beside the controls that
    // failed; what it no longer carries is a save model, a press or a "Saved". A THIRD
    // carrier fails this test, which is the property the file exists to hold.
    expect(
      carriers,
      "a further module quoting these keys is a third save-status source",
    ).toStrictEqual(["components/forms/form-settings-panel.tsx", "components/save-model.tsx"]);
  });

  it("leaves the settings panel a failure sentence and no save model of its own", () => {
    // `plan/admin-design-contracts.md` §6, amended 2026-08-29: the nested scope stopped
    // persisting on its own, so it stopped stating its own model. Each of these was true
    // of the panel before that amendment, which is why they are asserted rather than
    // assumed - a reinstated button is exactly how the second model would come back.
    const panel = source("components/forms/form-settings-panel.tsx");

    expect(panel.includes("<Button"), "the settings save on a debounce, not on a press").toBe(
      false,
    );
    expect(panel.includes("forms.settings.saved"), "no second confirmation").toBe(false);
    expect(panel.includes("<AmbientSaveStatus"), "no rival strip").toBe(false);
    expect(panel.includes("<ManualSaveNote"), "and no manual-model sentence").toBe(false);
    // The one thing it still says about saving, in the region that announces it. A refused
    // write has no press to report back to now, so this sentence is load-bearing.
    expect(panel).toContain("forms.settings.failed");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('data-testid="qcms-form-settings-status"');
  });

  it("saves the settings on the builder's own debounce rather than a second one", () => {
    // One save model on the screen means one timing on the screen. A settings autosave
    // with a debounce of its own would be a second model wearing the first one's clothes:
    // the strip would report two loops settling at different moments as one save state.
    const builder = source("components/forms/form-builder.tsx");

    expect(builder.match(/const AUTOSAVE_DEBOUNCE_MS/g)?.length ?? 0).toBe(1);
    expect(builder.match(/AUTOSAVE_DEBOUNCE_MS\)/g)?.length ?? 0).toBe(2);
    // The settings action is bound to this route and revalidates it, so it is read
    // through the same ref as the other two. Depending on the prop re-arms the effect on
    // every revalidation, which is a save loop that never settles.
    expect(builder).toContain("actions.current.updateSettings");
  });

  it("renders the ambient strip from exactly one component, the form builder", () => {
    const renderers = uiSources().filter(
      (file) => file !== "components/save-model.tsx" && source(file).includes("<AmbientSaveStatus"),
    );
    expect(renderers).toStrictEqual(["components/forms/form-builder.tsx"]);
  });

  it("never puts the ambient strip and a manual-model statement in one component", () => {
    for (const file of uiSources()) {
      const text = source(file);
      if (file === "components/save-model.tsx") continue;
      const both = text.includes("<AmbientSaveStatus") && text.includes("<ManualSaveNote");
      expect(both, `${file} states both save models`).toBe(false);
    }
  });

  it("leaves the validation panel counting issues and nothing else (element 7)", () => {
    const panel = source("components/forms/validation-panel.tsx");
    expect(panel.includes("forms.save."), "save state is out of the validation panel").toBe(false);
    expect(panel.includes("qcms-save-state"), "the save sentence moved with its testid").toBe(
      false,
    );
    // And the panel is still the issue authority: the count and the list both live here.
    expect(panel).toContain('data-testid="qcms-issue-summary"');
    expect(panel).toContain("forms.validation.count");
  });

  it("keeps the ambient strip free of anything that reads as an issue count", () => {
    const strip = source("components/save-model.tsx");
    for (const forbidden of ["issue", "Issue", "forms.validation.", "count"]) {
      expect(
        strip.includes(`t("${forbidden}`) || strip.includes(`{${forbidden}`),
        `the strip must not render ${forbidden}: the validation panel is the single issue authority`,
      ).toBe(false);
    }
  });
});

describe("every manual screen states its model", () => {
  it("renders a visible ManualSaveNote, never a title attribute", () => {
    for (const screen of SCREENS.filter((row) => row.model === "manual")) {
      const stated = screen.statedBy ?? "";
      const text = source(stated);
      expect(text, `${screen.route} states its manual model`).toContain("<ManualSaveNote");
      expect(text.includes("title={t("), `${stated} states it visibly, not as a tooltip`).toBe(
        false,
      );
    }
  });

  it("wires both editor modes to a sentence of their own", () => {
    const editor = source(QUESTION_EDITOR);
    expect(editor).toContain("questions.create.manualModel");
    expect(editor).toContain("questions.editor.manualModel");
  });
});
