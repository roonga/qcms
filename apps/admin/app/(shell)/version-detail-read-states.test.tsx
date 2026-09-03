import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue 614: what the version detail route keeps when a read fails, and what it drops.
 *
 * `plan/admin-design-contracts.md` §3 says a failed read renders the error alert "and
 * nothing else". Issue 521 settled what "nothing else" governs, and
 * `form-read-states.test.tsx` asserts it at four sites: nothing that CLAIMS anything about
 * the failed read. Chrome that stays true is not such a claim. A breadcrumb, an `h1`, the
 * rail beside the screen and a back link are navigation, and an operator who arrived on
 * this URL from a ticket needs them most at the moment a read fails.
 *
 * ## THE TWO BRANCHES ARE DELIBERATELY ASYMMETRIC. READ BEFORE "FIXING" EITHER.
 *
 * This route makes two reads and answers their failures differently, which looks like an
 * oversight until you ask what each failed read was carrying:
 *
 * - **The FORM read failed.** `FormPageHeader` is built from the form's slug and status,
 *   and both arrived on that read. There is no header to render, so the route returns the
 *   alert alone. That branch is CORRECT and this file pins it, precisely so a later reader
 *   who sees the version branch keep its header does not make this one match it and lose
 *   the distinction.
 * - **The VERSION read failed.** By then the form read has already succeeded, so the slug
 *   and the status are in hand, and the version number came from the route params rather
 *   than from the read. Every input the header needs survives the failure, and before
 *   issue 614 it was discarded anyway. It now renders, with the alert where the version
 *   body would be, which is the shape the sibling response detail route already ships.
 *
 * A test per branch, plus a success control, is what makes the asymmetry legible: two
 * failure tests alone would read as an inconsistency to copy in either direction.
 *
 * ## The rail is a third answer on the same screen
 *
 * Since issue 561 a `@rail` slot renders beside this route, and it makes its own reads
 * (`lib/server/form-rail.ts`). It never reads the version, so the version-read failure
 * cannot reach it, and it degrades to nothing when the FORM read fails. Both are asserted
 * below rather than assumed, because two failed-read states now interact on this screen
 * and "the rail is unaffected" is a claim about a module this route does not own.
 *
 * ## Why this layer, and not Playwright
 *
 * The reason `form-read-states.test.tsx` gives, and it is structural: these reads run in
 * the Next **server** process, so `page.route()` never sees the request and no browser
 * gesture can make `getFormVersion` fail. Rendering the server component with its reads
 * stubbed and asserting over the HTML it emits is the highest layer that reaches the
 * failure branches at all (ADR-23).
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORM_DETAIL = {
  formId: "frm_one",
  slug: "one",
  defaultLocale: "en",
  status: "open",
  draftSource: "open",
  versions: [{ version: 7, status: "published", publishedAt: "2026-08-01T10:00:00.000Z" }],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeEnforceable: false,
  draftAgentAssisted: false,
  draftUpdatedAt: null,
  draft: {
    formId: "frm_one",
    defaultLocale: "en",
    title: { en: "One" },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "Step one" },
        items: [{ questionId: "q_one", version: 1 }],
      },
    ],
    rules: [],
  },
};

const SNAPSHOT = {
  formId: "frm_one",
  version: 7,
  publishedAt: "2026-08-01T10:00:00.000Z",
  compilerVersion: "1.0.0",
  a2uiSpecVersion: "1.0.0",
  semanticsVersion: "1.0.0",
  definition: {},
  documents: [],
};

/** The API's failure shape (`lib/server/api-result.ts`), for a 503 that is not a 404. */
const UPSTREAM_FAILURE = { ok: false, code: "http_503", message: "upstream said 503", issues: [] };

/** Set per test before the page module is imported; the route reads both once, at render. */
let formDetailResult: unknown = { ok: true, data: FORM_DETAIL };
let versionResult: unknown = { ok: true, data: SNAPSHOT };

/**
 * `FormPageHeader` is the subject here, not a stand-in for it: the whole question is
 * whether the header renders, so a stub answering "yes" would assert nothing. It carries
 * no registration and runs for real. Its own `Breadcrumb` is stubbed below, in the kit,
 * which is where the rest of this suite draws the same line.
 *
 * `page-headings` and `form-rail` are deliberately absent from the registrations below:
 * they run for real. `page-headings` IS the id the `h1` assertion is about, and
 * `form-rail` is the degrade policy the rail block below is testing, so a stand-in shaped
 * like either would only assert that the stand-in is shaped like the subject.
 */
// Stubbed rather than left real: this route is not the builder, so `interactiveSteps` is
// false and the rail renders the plain step anchors instead of this component. The mock
// exists only so the slot's import resolves without pulling react-aria into a test about
// what a failed read renders.
vi.mock("@/components/forms/rail-steps", () => ({ RailSteps: () => null }));

/**
 * `t` answers with its own key, and with the parameters spliced in, so an assertion is
 * about WHICH string a branch chose and WHAT it was told rather than about the sentence
 * the catalog holds today. The version number in the `h1` is the load-bearing parameter:
 * it is the one the failed read did not supply.
 */
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string, params?: Readonly<Record<string, string | number>>) =>
    params === undefined ? key : `${key}(${Object.values(params).join(",")})`,
  tPlural: (one: string) => one,
}));

/**
 * Marked stand-ins. `Dialog` is not among them because nothing on this route renders one,
 * and it is worth saying why the neighbouring files all carry one: a react-aria `Dialog`
 * portals, and `renderToStaticMarkup` returns the empty string for a tree containing it
 * (issue 628). A page that grew one would need the stub or every assertion here would pass
 * against nothing.
 */
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
  Breadcrumb: () => <nav data-testid="qcms-breadcrumb-stub" />,
}));

vi.mock("@/components/forms/version-view", () => ({
  VersionView: () => <div data-testid="qcms-version-view-stub" />,
}));

vi.mock("@/components/forms/form-subtree-rail", () => ({
  FormSubtreeRail: ({ current }: { current: { readonly section?: string } }) => (
    <nav data-testid="qcms-rail-stub" data-current={current.section} />
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));

vi.mock("@/lib/server/config", () => ({
  previewPortalTheme: () => "default",
}));

/**
 * The reads, registered once and reaching two consumers.
 *
 * Two modules consume this file by two specifiers: the route imports `@/lib/server/forms`
 * and `lib/server/form-rail.ts` (real here, because its degrade policy is what the rail
 * block asserts) imports its neighbour as `./forms.ts`. Both spellings resolve to one
 * module id now that `@/` is aliased (issue 652), so one registration answers both; it
 * used to need two, and a suite that registered only the alias form left the rail reading
 * the real module and reaching for the network.
 */
vi.mock("@/lib/server/forms", () => ({
  getForm: () => Promise.resolve(formDetailResult),
  getFormVersion: () => Promise.resolve(versionResult),
  validateDraft: () => Promise.resolve({ ok: true, data: { valid: true, issues: [] } }),
}));

/** The route params for `/forms/frm_one/versions/7`, which every render below uses. */
const PARAMS = { formId: "frm_one", version: "7" };

async function renderVersionDetail(): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/versions/[version]/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve(PARAMS) }));
}

/**
 * The rail beside the same URL.
 *
 * The slot's own route file is three lines choosing which row is current; the reads and
 * the degrade policy live in `FormRailSlot`, so that is what is rendered. Rendering the
 * route file instead would hand `renderToStaticMarkup` an un-awaited async component.
 */
async function renderRail(): Promise<string> {
  const { FormRailSlot } = await import("./@rail/forms/[formId]/rail-slot.tsx");
  return renderToStaticMarkup(
    await FormRailSlot({
      params: Promise.resolve(PARAMS),
      current: { kind: "section", section: "versions" },
    }),
  );
}

beforeEach(() => {
  formDetailResult = { ok: true, data: FORM_DETAIL };
  versionResult = { ok: true, data: SNAPSHOT };
});

/**
 * The branch issue 614 corrects. Everything the header needs has already arrived, and
 * before this fix all of it was thrown away because a different read failed.
 */
describe("the version read failing (issue 614)", () => {
  it("keeps the breadcrumb, the h1, the back link and the identity line", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    // `soft`, so a regression reports every piece of chrome it dropped rather than only
    // the first. Against the pre-614 route all seven of these fail at once, which is the
    // shape of the defect: not one missing element but the whole header discarded.
    expect.soft(html).toContain('data-testid="qcms-breadcrumb-stub"');
    // The `h1` names the version, and names it from the route params: `snapshot.data` does
    // not exist in this branch, so a 7 here is proof the heading no longer depends on the
    // read that failed.
    expect.soft(html).toContain('id="qcms-version-heading"');
    expect.soft(html).toContain("forms.history.versionHeading(7)");
    expect.soft(html).toContain("forms.history.backToHistory");
    expect.soft(html).toContain('href="/forms/frm_one/versions"');
    // The identity line, which comes from the form read and is therefore still true.
    expect.soft(html).toContain("forms.builder.formId");
    expect.soft(html).toContain("forms.status.open");
  });

  it("replaces only the body, with the error alert", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    expect(html).toContain('data-testid="qcms-alert" data-variant="error"');
    expect(html).toContain("forms.history.failed(upstream said 503)");
    // The version body makes claims about the read that failed, so it is the one thing
    // that goes.
    expect(html).not.toContain('data-testid="qcms-version-view-stub"');
  });

  it("still 404s when the version simply does not exist", async () => {
    versionResult = { ...UPSTREAM_FAILURE, code: "VERSION_NOT_FOUND" };

    // Keeping the header must not turn a missing version into a rendered page: a URL
    // naming a version that was never published is a 404, not an error state.
    await expect(renderVersionDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

/**
 * THE BRANCH THAT IS CORRECT AS WRITTEN, PINNED SO IT STAYS THAT WAY.
 *
 * This is not the same case as the block above and must not be made to match it.
 * `FormPageHeader` renders the form's slug in its breadcrumb and its open/closed status in
 * the identity line, and both of those came from the read that just failed. There is no
 * header to render here: the alternative is a header captioned with a slug the app does
 * not have, which is the false claim §3 exists to prevent. The bare alert is the honest
 * answer, and it is deliberate rather than an oversight (issue 614's ruling says so
 * explicitly).
 */
describe("the form read failing, where the bare alert is the honest answer (issue 614)", () => {
  it("renders the alert alone, because the header's own inputs failed with the read", async () => {
    formDetailResult = UPSTREAM_FAILURE;

    const html = await renderVersionDetail();

    expect(html).toContain('data-testid="qcms-alert" data-variant="error"');
    expect(html).toContain("upstream said 503");
    // No slug to put in a breadcrumb, no status for an identity line, so no header.
    expect(html).not.toContain('data-testid="qcms-breadcrumb-stub"');
    expect(html).not.toContain('id="qcms-version-heading"');
    expect(html).not.toContain("forms.history.backToHistory");
    expect(html).not.toContain('data-testid="qcms-version-view-stub"');
  });

  it("still 404s when the form simply does not exist", async () => {
    formDetailResult = { ...UPSTREAM_FAILURE, code: "FORM_NOT_FOUND" };

    await expect(renderVersionDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

/**
 * The control. A fix that rendered the alert unconditionally, or that lost the version
 * body, would pass both failure blocks above.
 */
describe("the success path, unchanged", () => {
  it("renders the header, the back link and the version body, with no alert", async () => {
    const html = await renderVersionDetail();

    expect(html).toContain('id="qcms-version-heading"');
    expect(html).toContain("forms.history.versionHeading(7)");
    expect(html).toContain("forms.history.backToHistory");
    expect(html).toContain('data-testid="qcms-version-view-stub"');
    expect(html).not.toContain('data-testid="qcms-alert"');
  });
});

/**
 * The rail, which is the other thing on this screen with an opinion about a failed read.
 *
 * Its policy is `lib/server/form-rail.ts`'s and this route does not own it. What these two
 * assert is that the policy composes with the route's: the rail survives exactly the
 * failure the header survives, and goes exactly where the header goes.
 */
describe("the rail beside the same URL (issues 561, 614)", () => {
  it("is untouched by a failed version read, because it never reads the version", async () => {
    versionResult = UPSTREAM_FAILURE;

    const html = await renderRail();

    expect(html).toContain('data-testid="qcms-rail-stub"');
    expect(html).toContain('data-current="versions"');
  });

  it("degrades to nothing when the form read fails, leaving the screen's alert to speak", async () => {
    formDetailResult = UPSTREAM_FAILURE;

    const html = await renderRail();

    expect(html).toBe("");
  });
});
