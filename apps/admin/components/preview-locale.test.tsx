import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  DraftForm,
  DraftPreview as DraftPreviewPayload,
  FormVersionSnapshot,
} from "@/lib/forms/types";
import { DEFAULT_LOCALE } from "@/lib/i18n/format";
import type { PreviewDocument } from "@/lib/questions/types";

/**
 * Every preview surface hands the renderer the deployment's QCMS_LOCALE (issue #906; the
 * operator-set locale by the Code Owner ruling of 2026-10-19).
 *
 * ## What is under examination, and why it is the prop rather than the pixels
 *
 * `A2UIStepRenderer`'s `locale` prop is optional and `@roonga/qcms-ui`'s own default is
 * `en-US`, so a surface that omits it renders respondent controls - a date field's segment
 * order and placeholders, its calendar, a number field's stepper announcements - on a tag
 * this app never chose. All three admin previews omitted it, which is the defect; the
 * portal's two call sites had the same one until issue #729.
 *
 * The obvious test would read the rendered DOM. It cannot work, and the reason is measured
 * rather than assumed: `packages/ui/src/locale.test.tsx` renders the entire golden corpus
 * under `en` and under `en-US` and the markup is identical, because for everything a
 * compiled A2UI step contains the two tags resolve the same CLDR data. So no rendered
 * assertion can distinguish a surface that passes `en` from one that passes nothing, and a
 * test claiming to check the locale by looking at a date field would be a green that means
 * nothing. What IS checkable is the value that arrives at the renderer, so that is what
 * this file checks, on all three surfaces, through the seam they share.
 *
 * The renderer is therefore the one part stubbed: it re-emits the props that matter as DOM
 * so they can be asserted the way anything else in jsdom is. Everything above it is real -
 * the three components, the island they mount inside, the visible-set projection, the
 * catalog and the locale provider the root layout mounts.
 */

/** Where the stub writes what it received, per mounted preview. */
const RENDERER = "qcms-test-renderer";

vi.mock("@roonga/qcms-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@roonga/qcms-ui")>();
  return {
    ...actual,
    A2UIStepRenderer: ({ locale, document }: { locale?: string; document: { stepId: string } }) => (
      <div data-testid={RENDERER} data-locale={locale ?? "(absent)"} data-step={document.stepId} />
    ),
  };
});

const { DraftPreview } = await import("./forms/draft-preview.tsx");
const { VersionView } = await import("./forms/version-view.tsx");
const { QuestionPreview } = await import("./questions/question-preview.tsx");
const { LocaleProvider } = await import("./locale-context.tsx");

/** A locale that differs from both the default and the renderer's own, as QCMS_LOCALE may. */
const CONFIGURED = "de-DE";

/** One compiled step, shaped as the compiler emits one: a `Form` over one control. */
const STEP = {
  stepId: "stp_about",
  root: {
    type: "Form",
    children: [
      { type: "Text", props: { as: "h1" }, children: "Intake" },
      { type: "DateField", props: { name: "q_born_on", label: "Date of birth" } },
    ],
  },
};

const DRAFT: DraftForm = {
  formId: "frm_intake",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: STEP.stepId, title: { en: "About you" }, items: [] }],
  rules: [],
};

const DRAFT_PREVIEW: DraftPreviewPayload = {
  documents: [STEP],
  compilerVersion: "0.1.0",
  a2uiSpecVersion: "1.0.0",
  flow: {
    visibleSteps: [STEP.stepId],
    visibleQuestions: ["q_born_on"],
    complete: false,
    rosters: [],
  },
};

const SNAPSHOT = {
  formId: DRAFT.formId,
  version: 1,
  publishedAt: "2026-01-01T00:00:00.000Z",
  compilerVersion: "0.1.0",
  a2uiSpecVersion: "1.0.0",
  semanticsVersion: "1",
  definition: {},
  documents: [STEP],
} as unknown as FormVersionSnapshot;

const QUESTION_PREVIEW: PreviewDocument = {
  stepId: STEP.stepId,
  root: STEP.root,
  a2uiSpecVersion: "1.0.0",
  compilerVersion: "0.1.0",
};

/** The locale that reached the renderer mounted inside the island, and only that one. */
async function localeReachingTheRenderer(): Promise<string> {
  const island = await screen.findByTestId("qcms-preview-surface");
  const renderer = await within(island).findByTestId(RENDERER);
  return renderer.getAttribute("data-locale") ?? "";
}

describe("the locale each preview surface declares", () => {
  it("defaults to en-GB, which is not the renderer's own en-US default", () => {
    // The premise, stated once: this only matters because the package default differs
    // from what the app declares.
    expect(DEFAULT_LOCALE).toBe("en-GB");
  });

  it("reaches the renderer from the draft preview", async () => {
    render(
      <LocaleProvider locale={CONFIGURED}>
        <DraftPreview
          draft={DRAFT}
          defaultTheme="slate"
          preview={() => Promise.resolve({ status: "ok", preview: DRAFT_PREVIEW })}
        />
      </LocaleProvider>,
    );
    expect(await localeReachingTheRenderer()).toBe(CONFIGURED);
  });

  it("reaches the renderer from the published version view", async () => {
    render(
      <LocaleProvider locale={CONFIGURED}>
        <VersionView snapshot={SNAPSHOT} defaultTheme="slate" />
      </LocaleProvider>,
    );
    expect(await localeReachingTheRenderer()).toBe(CONFIGURED);
  });

  it("reaches the renderer from the single-question preview", async () => {
    render(
      <LocaleProvider locale={CONFIGURED}>
        <QuestionPreview preview={QUESTION_PREVIEW} resetKey={1} defaultTheme="slate" />
      </LocaleProvider>,
    );
    expect(await localeReachingTheRenderer()).toBe(CONFIGURED);
  });

  it("falls back to the default when no provider is mounted (a unit tree, never a page)", async () => {
    render(<VersionView snapshot={SNAPSHOT} defaultTheme="slate" />);
    expect(await localeReachingTheRenderer()).toBe(DEFAULT_LOCALE);
  });
});
