import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type SaveModel = "autosave" | "manual" | "action" | "readonly";

interface ScreenRow {
  readonly route: string;
  readonly model: SaveModel;

  readonly statedBy?: string;

  readonly why: string;
}

const QUESTION_SAVE = "components/questions/question-save.tsx";

const SCREENS: readonly ScreenRow[] = [
  {
    route: "app/page.tsx",
    model: "readonly",
    why: "A redirect to the caller's first permitted area. It renders nothing.",
  },
  {
    route: "app/sign-in/page.tsx",
    model: "action",
    why: "Credentials submitted once. Nothing is authored and nothing accumulates.",
  },
  {
    route: "app/change-password/page.tsx",
    model: "action",
    why: "The forced change on first sign-in after bootstrap (task 061). One credential submitted once; nothing is authored and nothing accumulates, so there is nothing to autosave and nothing to lose by navigating away.",
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
    route: "app/(shell)/forms/[formId]/rules/page.tsx",
    model: "autosave",
    why: "The rules editor, on its own route since issue #669. It holds the same working draft the builder holds and stores it through the same 600ms loop (`lib/forms/autosave.ts`), so it carries an ambient strip of its own - a screen holding accumulated authored state owes a statement of when that state was stored, and the builder's strip is one route away describing a different copy.",
  },
  {
    route: "app/(shell)/forms/[formId]/preview/page.tsx",
    model: "readonly",
    why: "Renders the draft for inspection; its own copy already says nothing here is saved.",
  },

  {
    route: "app/(shell)/@rail/forms/[formId]/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/forms/[formId]/rules/page.tsx",
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
    route: "app/(shell)/@rail/forms/[formId]/publish/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/links/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/responses/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/responses/[sessionId]/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/webhooks/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/intake/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/operations/forms/[formId]/erase/page.tsx",
    model: "readonly",
    why: "Navigation only. §7 gives the rail no actions at all, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/settings/page.tsx",
    model: "readonly",
    why: "Navigation only. §7a gives the Settings rail no actions and no counts, so there is nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/questions/[questionId]/page.tsx",
    model: "action",
    why: "Publish, deprecate and new version, each a discrete confirmed operation that reports its own outcome inside its dialog. The version rows beside them are navigation.",
  },

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
    why: "A rail Header beside a route that redirects, so nothing renders and nothing is stored.",
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
    route: "app/(shell)/operations/forms/[formId]/links/page.tsx",
    model: "action",
    why: "Mint and revoke. Its live region reports the outcome of a completed action, not a save state.",
  },
  {
    route: "app/(shell)/operations/forms/[formId]/responses/page.tsx",
    model: "readonly",
    why: "Browse, filter and export. Nothing is authored.",
  },
  {
    route: "app/(shell)/operations/forms/[formId]/responses/[sessionId]/page.tsx",
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
    route: "app/(shell)/forms/[formId]/publish/page.tsx",
    model: "action",
    why: "One discrete act built up over three steps (ADR-40, issue #1197): a source, its destinations, then one confirmation. Nothing accumulating is saved, and that is the contract rather than an omission - back and cancel write nothing at all, so a half-built intent has to be unrecoverable by construction.",
  },
  {
    route: "app/(shell)/operations/forms/[formId]/webhooks/page.tsx",
    model: "action",
    why: "Add, retarget, rotate, activate. Each is a discrete confirmed operation with its own outcome region.",
  },
  {
    route: "app/(shell)/operations/forms/[formId]/intake/page.tsx",
    model: "action",
    why: "Close and reopen, each one confirmed act in one environment with its own outcome region. The reading above them is not authored.",
  },
  {
    route: "app/(shell)/operations/forms/[formId]/erase/page.tsx",
    model: "action",
    why: "Find one session, then erase it: a type-to-confirm act in one environment with its own outcome region. The id typed to find it is not stored.",
  },
  {
    route: "app/(shell)/questions/page.tsx",
    model: "readonly",
    why: "A searchable library listing.",
  },
  {
    route: "app/(shell)/questions/new/page.tsx",
    model: "manual",
    statedBy: QUESTION_SAVE,
    why: "The question editor in create mode: a whole document held on screen and stored only by pressing Create draft. This is the screen an author reaches after learning the builder autosaves.",
  },
  {
    route: "app/(shell)/questions/[questionId]/page.tsx",
    model: "manual",
    statedBy: QUESTION_SAVE,
    why: "The question editor in edit mode. Same document, same explicit press. The lifecycle actions moved to this screen's rail in issue 650 and are inventoried on that slot's own row; they are discrete operations and report no save state either way.",
  },
  {
    route: "app/(shell)/me/access/page.tsx",
    model: "readonly",
    why: "What this account holds. A grant is not something its holder changes, so there is nothing on the screen to store.",
  },
  {
    route: "app/(shell)/@rail/me/access/page.tsx",
    model: "readonly",
    why: "A rail Header and nothing else.",
  },
  {
    route: "app/(shell)/operations/page.tsx",
    model: "readonly",
    why: "The forms a caller operates. A list screen stores nothing; its filters live in the address.",
  },
  {
    route: "app/(shell)/@rail/operations/page.tsx",
    model: "readonly",
    why: "The forms table's filters and the installation queues. Filters live in the address.",
  },
  {
    route: "app/(shell)/responses/page.tsx",
    model: "readonly",
    why: "Redirects to the Operations forms table and renders nothing.",
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
  {
    route: "app/(shell)/@rail/workspaces/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/@rail/workspaces/[workspaceId]/page.tsx",
    model: "readonly",
    why: "Returns null. The route has a rail, contributes no section of its own, and so has nothing on it to save.",
  },
  {
    route: "app/(shell)/workspaces/page.tsx",
    model: "readonly",
    why: "The workspaces this administrator administers, and their own grants. Nothing on it is authored: a grant is not something its holder changes, and the one act a reader can take from here is following a link to a workspace.",
  },
  {
    route: "app/(shell)/workspaces/[workspaceId]/page.tsx",
    model: "action",
    why: "Grants, revokes, a member row's role and the two workspace settings. Every one is a deliberate act reported as an outcome and written to the access audit, which is exactly why none of them autosaves: a switch that saved on every keystroke would put a row in the audit for a change nobody finished making.",
  },
];

const APP_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(APP_ROOT, relative), "utf8");
}

function filesUnder(top: string, keep: (name: string) => boolean): readonly string[] {
  return readdirSync(join(APP_ROOT, top), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => relative(APP_ROOT, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort((left, right) => left.localeCompare(right));
}

function routeFiles(): readonly string[] {
  return filesUnder("app", (name) => name === "page.tsx");
}

function uiSources(): readonly string[] {
  const tsx = (name: string): boolean => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name);
  return [...filesUnder("app", tsx), ...filesUnder("components", tsx)];
}

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

  it("names the two autosaving screens, which are the two that edit the working draft", () => {
    const autosaving = SCREENS.filter((screen) => screen.model === "autosave");
    expect(autosaving.map((screen) => screen.route)).toStrictEqual([
      "app/(shell)/forms/[formId]/page.tsx",
      "app/(shell)/forms/[formId]/rules/page.tsx",
    ]);
  });
});

describe("no screen shows two different save-state statements", () => {
  it("keeps every save-state sentence in the one module, plus the settings' own refusal", () => {
    const carriers = uiSources().filter((file) =>
      SAVE_STATE_KEYS.some((key) => source(file).includes(`"${key}"`)),
    );

    expect(
      carriers,
      "a further module quoting these keys is a third save-status source",
    ).toStrictEqual(["components/forms/form-settings-panel.tsx", "components/save-model.tsx"]);
  });

  it("leaves the settings panel a failure sentence and no save model of its own", () => {
    const panel = source("components/forms/form-settings-panel.tsx");

    expect(panel.includes("<Button"), "the settings save on a debounce, not on a press").toBe(
      false,
    );
    expect(panel.includes("forms.settings.saved"), "no second confirmation").toBe(false);
    expect(panel.includes("<AmbientSaveStatus"), "no rival strip").toBe(false);
    expect(panel.includes("<ManualSaveNote"), "and no manual-model sentence").toBe(false);

    expect(panel).toContain("forms.settings.failed");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('data-testid="qcms-form-settings-status"');
  });

  it("declares the debounce once in the app, and saves the settings on it", () => {
    const tsx = (name: string): boolean => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name);
    const declarations = [...uiSources(), ...filesUnder("lib", tsx)].filter((file) =>
      /const AUTOSAVE_DEBOUNCE_MS/u.test(source(file)),
    );
    expect(
      declarations,
      "the debounce is declared in the shared loop and nowhere else",
    ).toStrictEqual(["lib/forms/autosave.ts"]);

    const builder = source("components/forms/form-builder.tsx");
    expect(builder).toContain("AUTOSAVE_DEBOUNCE_MS");

    expect(builder).toContain("settingsAction.current");
  });

  it("routes both drafting screens through the one save loop", () => {
    for (const file of ["components/forms/form-builder.tsx", "components/forms/rules-screen.tsx"]) {
      expect(source(file), `${file} stores through the shared loop`).toContain("useDraftAutosave");
    }
  });

  it("renders the ambient strip from the two components that own a draft, and no others", () => {
    const renderers = uiSources().filter(
      (file) => file !== "components/save-model.tsx" && source(file).includes("<AmbientSaveStatus"),
    );
    expect(renderers).toStrictEqual([
      "components/forms/form-builder.tsx",
      "components/forms/rules-screen.tsx",
    ]);
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
    const control = source(QUESTION_SAVE);
    expect(control).toContain("questions.create.manualModel");
    expect(control).toContain("questions.editor.manualModel");
  });
});
