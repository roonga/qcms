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
 * ## The one known exception, recorded rather than asserted away
 *
 * The form builder screen renders `FormSettingsPanel` inside a collapsed `<details>`, and
 * that panel has its own explicit Save button and its own "Settings saved." live region
 * (`components/form-settings-panel.tsx`). So the builder route is `autosave` for the draft
 * and manual for two deployment switches nested inside it. Contract §6 addresses screens,
 * not nested scopes, and it does not say which wins - so issue 518 left the panel alone
 * and escalated it rather than deciding. The inventory below records the builder's model
 * as `autosave` because that is what the *screen* does and what the ambient strip claims;
 * if the escalation resolves the other way, this row and the strip move together.
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
    route: "app/(shell)/forms/page.tsx",
    model: "action",
    why: "A two-field slug-and-title fieldset that creates a form and navigates to it. Nothing accumulates, so there is no unsaved work a statement would protect.",
  },
  {
    route: "app/(shell)/forms/[formId]/page.tsx",
    model: "autosave",
    why: "The one autosaving screen in the app: a 600ms debounce over the whole draft. Carries the ambient strip (design-language element 7). See the nested-scope note above.",
  },
  {
    route: "app/(shell)/forms/[formId]/preview/page.tsx",
    model: "readonly",
    why: "Renders the draft for inspection; its own copy already says nothing here is saved.",
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
    why: "The question editor in edit mode. Same document, same explicit press. The lifecycle actions beside it are discrete operations and report no save state.",
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

/** Every module that can put something on a screen. */
function uiSources(): readonly string[] {
  const tsx = (name: string): boolean => /\.tsx?$/u.test(name);
  return [...filesUnder("app", tsx), ...filesUnder("components", tsx)];
}

/**
 * The message keys that state a save STATE (as opposed to the outcome of one action the
 * author just took). These are what a screen may carry at most one set of.
 */
const SAVE_STATE_KEYS = [
  "forms.save.model",
  "forms.save.idle",
  "forms.save.saving",
  "forms.save.saved",
  "forms.save.failed",
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
        expect(screen.statedBy, `${screen.route} is not manual and must not name one`).toBeUndefined();
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
  it("keeps every save-state sentence in one module", () => {
    const carriers = uiSources().filter((file) =>
      SAVE_STATE_KEYS.some((key) => source(file).includes(`"${key}"`)),
    );
    expect(
      carriers,
      "a second module quoting these keys is a second save-status source",
    ).toStrictEqual(["components/save-model.tsx"]);
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
