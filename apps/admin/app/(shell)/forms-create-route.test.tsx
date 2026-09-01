import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue 685: creating a form happens on its own route, the way creating a question does.
 *
 * `plan/admin-shell-poc/library-lists-poc.html` picks one creation pattern for BOTH
 * library screens - a separate route reached from a header link - and names the forms
 * list's inline create card as the screen that should change to match. The comment sits on
 * the question-library screen and is restated on the forms screen, and its reasoning is
 * the one this file is really guarding: **minting an id is a one-way door (R6)**. A form
 * id is derived from the slug once and never reused, so a form created with a mistyped
 * slug is a permanent artefact of the deployment rather than something that can be renamed
 * afterwards. A creating affordance wedged between a page heading and a table of
 * everything already made competes for attention with both; a screen of its own asks for
 * it.
 *
 * The second argument is about the list: an inline card pushed the very thing an author
 * opened `/forms` to browse below the fold on every visit, including the visits where they
 * came only to look.
 *
 * ## What is pinned here, and what is deliberately pinned as an INVARIANT
 *
 * The first three blocks are the change: `/forms` carries no creating form, it links to
 * `/forms/new`, and `/forms/new` is the screen that holds the three fields.
 *
 * The last block is the control, and its test names say so. `/questions` already shipped
 * this exact pattern, so it is the reference rather than a second thing to change: if an
 * assertion in that block goes red alongside a change to the forms screens, the guard was
 * testing the change rather than the invariant it claims to hold.
 *
 * ## Why this layer
 *
 * The same reason `empty-and-table-states.test.tsx` and `forms-list-states.test.tsx` give:
 * these are server components whose reads run in the Next server process, so `page.route()`
 * cannot reach them and the empty-library branch is not reachable from a browser against a
 * seeded fixture. Rendering the page component with its read stubbed and asserting over
 * the markup it emits is the highest layer that can see all of its states (ADR-23's
 * "highest layer that exists for it"). The browser's share of the claim - that the link
 * navigates, that the fields on the far side create a form - is `forms-builder.pw.ts` and
 * every spec that reaches a builder through `e2e/support/forms.ts`, which now walks the
 * new route to get there.
 *
 * ## Red-first, against the pre-change tree
 *
 * Seven failed, three passed. The four in the first block: the list rendered a `<form>`
 * and a `data-field="slug"`, it contained `forms.create.`, `hrefs` held no `/forms/new`,
 * and the empty case counted 0 of them where 1 was expected. The three in the second
 * block all failed the same way, on `Cannot find module './forms/new/page.tsx'`.
 *
 * The three that PASSED are the whole control block, which is the point of having one:
 * the invariant was already true before the change and stayed true after it.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** Set per test before the page module is imported; each page reads once, at render. */
let formsResult: unknown = { ok: true, data: [] };
let questionsResult: unknown = { ok: true, data: [] };

const FORM_ROW = {
  formId: "frm_vehicle_insurance",
  slug: "vehicle-insurance",
  defaultLocale: "en",
  status: "open",
  hasDraft: true,
  publishedVersion: null,
  publishedAt: null,
};

const QUESTION_ROW = {
  questionId: "q_cover_type",
  slug: "cover-type",
  type: "shortText",
  status: "draft",
  label: { en: "Type of cover" },
  createdAt: "2026-08-01T10:00:00.000Z",
  latestVersion: 1,
};

/**
 * The `@/` alias is a Next/tsconfig path and Vitest resolves nothing for it (issue 652;
 * the root config is deliberately the only one, task 001, and declares no alias). Modules
 * whose output IS part of the claim are redirected to the real thing by relative path;
 * modules that are only scenery are replaced.
 */
vi.mock("@/components/empty-state", () => import("../../components/empty-state"));
vi.mock("@/lib/questions/errors", () => import("../../lib/questions/errors"));
vi.mock("@/lib/questions/types", () => import("../../lib/questions/types"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft"));
vi.mock("@/lib/forms/builder-state", () => import("../../lib/forms/builder-state"));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  listForms: () => Promise.resolve(formsResult),
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: () => Promise.resolve(questionsResult),
}));

/**
 * `t` answers with its own key, so every assertion is about WHICH string a screen chose
 * rather than about the sentence it holds today. That is what lets the copy move without
 * this file noticing, while "the list screen names no part of the create copy" stays a
 * precise claim rather than a substring guess.
 */
// The real title helper: `generateMetadata` is not what these tests render, so the module
// only has to resolve. Pointed at the real one rather than stubbed, so a change to the
// helper cannot be absorbed by a stand-in nobody maintains (issue #536).
vi.mock("@/lib/page-title", () => import("../../lib/page-title.ts"));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

/** Marked stand-ins, so the kit's own markup never confuses an assertion. */
vi.mock("@/components/kit", () => ({
  Alert: ({ children }: { children?: ReactNode }) => <div data-testid="qcms-alert">{children}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Card: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-card-stub">{children}</div>
  ),
  Select: () => <select aria-label="stub" />,
  TextField: ({ name, label }: { name?: string; label?: string }) => (
    <input aria-label={label ?? "stub"} data-field={name ?? ""} />
  ),
}));

/** The tables are scenery here: what they list is other files' subject. */
vi.mock("./forms/forms-table", () => ({
  FormsTable: () => <div data-testid="qcms-forms-table-stub" />,
}));
vi.mock("@/components/questions/questions-table", () => ({
  QuestionsTable: () => <div data-testid="qcms-questions-table-stub" />,
}));

/**
 * The create action is stubbed rather than removed, and that is part of the claim: the
 * inline card and the new route post to the SAME server action, so creating a form never
 * stopped working while the affordance moved. Nothing here calls it - a static render only
 * binds it - but `./forms/new/page.tsx` failing to import it would fail this file.
 */
vi.mock("./forms/actions", () => ({
  createFormAction: () => Promise.resolve({ status: "idle" }),
}));

async function renderForms(): Promise<string> {
  const { default: Page } = await import("./forms/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderNewForm(): Promise<string> {
  const { default: Page } = await import("./forms/new/page.tsx");
  return renderToStaticMarkup(await Page());
}

async function renderQuestions(searchParams: Record<string, string>): Promise<string> {
  const { default: Page } = await import("./questions/page.tsx");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

/** Every `href` in a render, in document order. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

beforeEach(() => {
  formsResult = { ok: true, data: [] };
  questionsResult = { ok: true, data: [] };
});

describe("the forms list stops creating inline (issue 685)", () => {
  it("renders no creating form on the list screen, at any state of the list", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };
    const populated = await renderForms();
    formsResult = { ok: true, data: [] };
    const empty = await renderForms();

    for (const markup of [populated, empty]) {
      // The card as a whole: no `<form>` element, and no field of the one that was there.
      expect(markup).not.toMatch(/<form[\s>]/u);
      expect(markup).not.toContain('data-field="slug"');
      expect(markup).not.toContain('data-field="defaultLocale"');
    }
  });

  it("names no part of the create copy on the list screen", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };

    const markup = await renderForms();

    // `forms.create.` prefixes every string the card used, so one assertion rules out the
    // legend, the three labels, the three hints, the id preview and the submit button at
    // once. The claim is "no part of the creating form", not "not this one string".
    expect(markup).not.toContain("forms.create.");
  });

  it("points at the new route from the list header once the library has rows", async () => {
    formsResult = { ok: true, data: [FORM_ROW] };

    const markup = await renderForms();

    expect(hrefs(markup)).toContain("/forms/new");
    expect(markup).toContain("forms.new");
  });

  it("moves the creating action into the empty panel, and leaves one control carrying it", async () => {
    const markup = await renderForms();

    // `plan/admin-design-contracts.md` §3: the panel carries the primary CTA when the
    // creating action lives somewhere else, which after this issue it does. The header
    // link stands down while the panel is showing, for the reason `/questions` states in
    // place: two controls with one accessible name are ambiguous to anyone navigating by
    // name.
    expect(markup).toContain('<div class="qcms-empty"');
    expect(hrefs(markup).filter((href) => href === "/forms/new")).toHaveLength(1);
    expect(markup).toContain("forms.empty.title");
  });
});

describe("the new-form route (issue 685)", () => {
  it("holds the three fields the inline card held", async () => {
    const markup = await renderNewForm();

    expect(markup).toContain('data-field="slug"');
    expect(markup).toContain('data-field="title"');
    expect(markup).toContain('data-field="defaultLocale"');
  });

  it("heads the screen with its own name and a way back to the list", async () => {
    const markup = await renderNewForm();

    expect(markup).toMatch(/<h1[^>]*>forms\.create\.title<\/h1>/u);
    expect(hrefs(markup)).toContain("/forms");
    expect(markup).toContain("forms.backToList");
  });

  it("says what the permanent id will be, where the choice that mints it is made", async () => {
    const markup = await renderNewForm();

    // The R6 half of the POC's reasoning, rendered rather than argued: the screen states
    // the id is derived and permanent, in the same callout `/questions/new` uses.
    expect(markup).toContain("qcms-id-callout");
    expect(markup).toContain("forms.create.id");
    expect(markup).toContain("forms.create.idNote");
  });
});

/**
 * The control block. `/questions` shipped this pattern first and issue 685 changes nothing
 * about it, so these assertions must be green on BOTH sides of the change. A failure here
 * beside a green block above means the guard was written around the change instead of
 * around the invariant.
 */
describe("the question library's shipped pattern is unchanged by issue 685", () => {
  it("still links to /questions/new from its header when the library has rows", async () => {
    questionsResult = { ok: true, data: [QUESTION_ROW] };

    const markup = await renderQuestions({});

    expect(hrefs(markup)).toContain("/questions/new");
  });

  it("still offers the creating action from the panel alone when the library is empty", async () => {
    const markup = await renderQuestions({});

    expect(hrefs(markup).filter((href) => href === "/questions/new")).toHaveLength(1);
  });

  it("still renders no creating form on the list screen itself", async () => {
    questionsResult = { ok: true, data: [QUESTION_ROW] };

    const markup = await renderQuestions({});

    // The filter form is a GET form and is not a creating action, so the claim is the
    // narrow one: none of the create screen's copy is here.
    expect(markup).not.toContain("questions.create.");
  });
});
