import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { HARNESS_THEME } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  appearanceTrigger,
  enrollNewAdmin,
  openMenu,
  settleTransitions,
  signInWithTotp,
} from "./support/flow.js";
import { chooseOption } from "./support/forms.js";
import { createDraft } from "./support/questions.js";

/**
 * The preview theme island (task 058, ADR-38), driven through the browser.
 *
 * ## What is actually under examination
 *
 * One sentence: **the island resolves respondent tokens and the authoring chrome around
 * it resolves its own, and neither moves the other.** Everything below is that sentence
 * measured, and it is measured as *computed style against known token values* rather
 * than as "a class is present", because the class being present is precisely what a
 * broken scoping still gets right - task 058's predecessor parked on the discovery that
 * `data-theme="harbor"` on a container matched nothing at all in the shipped sheets.
 *
 * The values below are copied from `packages/ui/src/theme.css` and are the assertion's
 * whole point. They are the one place in `apps/admin` where a colour is written down
 * outside `app/theme.css`, and that is legal only because this file is a test: the
 * `check-admin-theme.mjs` gate scans `app/` and `components/`, and it scans them exactly
 * so that the *product* can never hold a copy of these numbers. A test that asserted
 * "some colour changed" instead would pass against an island painted in Cobalt.
 *
 * ## Provable red: three probes, each run against this file
 *
 * A green assertion is worth nothing until it has been seen to fail for the reason it
 * names, so each half of the mechanism was removed in turn and the result recorded here.
 * (Playwright's serial mode stops the file at the first failure, so each probe's evidence
 * is *which* test went red on *which* predicate, not a count of reds.)
 *
 * 1. **The carrier attribute removed** from the island's container. The first-paint test
 *    fails on `--color-primary`, receiving the authoring app's Cobalt `#2456c6` where the
 *    configured Harbor `#1f5eb8` was expected. That is the whole scoping mechanism, and
 *    without it the class and the attribute are both still present and still inert -
 *    which is exactly the state task 058's predecessor parked on.
 * 2. **The carrier's restatement of the type-scale floors removed** (attribute intact).
 *    The first-paint test fails on the type-scale object with `letterSpacing`,
 *    `wordSpacing` and `fontFamily` moved: the island renders in Lexend at the authoring
 *    app's spacing while every colour and geometry token still resolves correctly. It
 *    also showed that `fontSize` and `lineHeight` do NOT discriminate (see TYPE_FLOORS).
 * 3. **The container frozen at the defaults** while the switcher still moves visibly.
 *    The first-paint test still passes, and "switching the island restyles the island
 *    only" fails on `islandAfter.primary`. That is the probe that matters most: it is the
 *    vacuous green the topbar's byte-identical check would otherwise report, and it is
 *    caught only because that check is paired with an assertion that the island DID move.
 *
 * ## The portalled overlays are deliberately not asserted here
 *
 * `Select`, `DatePicker`'s calendar and `Menu` render their popover into a portal on
 * `document.body`, outside the carrier, so they inherit the authoring app's tokens and
 * no selector can reach them. This accepted limitation is documented in
 * `components/preview-theme-island.tsx`. The question type
 * used below (`Multiple choice`) renders checkboxes, which are real descendants, so
 * below (`Multiple choice`) uses descendant checkboxes, so this test does not depend on
 * portal behavior.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("island");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Question ids are never reused (R6) and the harness database outlives a run. */
const RUN = Date.now().toString(36);

/**
 * Known token values, verbatim from `packages/ui/src/theme.css`.
 *
 * `primary` is read as a custom property, so it is compared as the sheet spells it.
 * `background` and `text` are read as PAINTED properties (the carrier's own
 * `background-color` and `color`), so they arrive resolved and are compared as `rgb()`.
 * Both forms are asserted deliberately: a custom property can be declared on an element
 * and still paint nothing if no rule consumes it.
 */
const THEMES = {
  slate: { primary: "#2c6e63", background: "rgb(251, 252, 253)", text: "rgb(15, 23, 41)" },
  harbor: { primary: "#1f5eb8", background: "rgb(232, 238, 246)", text: "rgb(14, 22, 38)" },
  sand: { primary: "#a24e2c", background: "rgb(247, 241, 230)", text: "rgb(35, 26, 18)" },
  plum: { primary: "#6d28a8", background: "rgb(242, 236, 249)", text: "rgb(26, 18, 38)" },
} as const;

/** Harbor under each mode. Dark and High-contrast are the two override layers. */
const HARBOR_BY_MODE = {
  light: { primary: "#1f5eb8", background: "rgb(232, 238, 246)" },
  dark: { primary: "#6fa8ff", background: "rgb(8, 17, 31)" },
  // The HC layer is universal and a theme contributes only its AAA accent, so this
  // accent is `[data-theme="harbor"].hc` while the background is the shared white.
  hc: { primary: "#0a3a8a", background: "rgb(255, 255, 255)" },
} as const;

const PLUM_DARK = { primary: "#c08cf0", background: "rgb(21, 10, 34)" } as const;

/**
 * The authoring app's own Cobalt values (`apps/admin/app/theme.css`), which the island
 * must never resolve.
 *
 * `--radius-control` is here for a reason the parked session's handoff records: the
 * island's risk is not only colour. Cobalt re-declares the geometry tokens too (4px
 * against the portal's 6px), so an island that re-declared colours alone would render
 * respondent controls with authoring-app corners. ADR-38's carrier re-declares the whole
 * token set on the element, which is what this pair proves.
 */
const COBALT_LIGHT = { primary: "#2456c6", radiusControl: "4px" } as const;
const PORTAL_RADIUS_CONTROL = "6px";

/**
 * The WCAG 1.4.12 text-spacing floors as they compute at the portal's 16px body size:
 * `--type-letter-spacing: 0.12em` and `--type-word-spacing: 0.16em` against a 16px
 * `--type-body`, with `--type-line-height: 1.5` and the brand-neutral system stack.
 *
 * **Three of these five discriminate and two do not, and the difference was measured
 * rather than assumed.** Stripping the carrier's restatement (see the header's provable-
 * red note) moves `letterSpacing`, `wordSpacing` and `fontFamily`; it leaves `fontSize`
 * and `lineHeight` exactly where they are, because Tailwind's preflight already sets
 * `line-height: 1.5` on the document and the authoring app's own body size is 16px too.
 * So those two agree by coincidence: they are consistency checks that the island did not
 * drift, not evidence that the carrier applied anything. They are kept for that first
 * job and labelled here so no later reader mistakes them for the second.
 */
const TYPE_FLOORS = {
  fontSize: "16px",
  lineHeight: "24px",
  letterSpacing: "1.92px",
  wordSpacing: "2.56px",
  // The first family only: the portal's stack resolved from `--font-portal`, against
  // this app's Lexend. `fonts.css` is deliberately not imported here, so this value can
  // only have come from the token sheet's anchor block resolving on the carrier.
  fontFamily: "ui-sans-serif",
} as const;

/** The labels the catalog gives the two controls (ADR-27). */
const THEME_LABEL = "Preview theme";
const MODE_LABEL = "Preview mode";

/** The admin's own mode menu items, by the name the shell renders. */
const ADMIN_MODE_LABEL = { light: "Light", dark: "Dark", hc: "High contrast" } as const;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the rest of this file signs in with", async ({ page }) => {
  test.setTimeout(120_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret).not.toBe("");
});

/** The carrier: `qcms-preview-surface` wearing ADR-38's scope attribute. */
function island(page: Page): Locator {
  return page.getByTestId("qcms-preview-surface");
}

/** One resolved custom property on an element, as the cascade leaves it there. */
function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

/** One computed style property, resolved (so a colour arrives as `rgb(...)`). */
function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/** The five text-spacing properties {@link TYPE_FLOORS} names, in one round trip. */
function typeScaleOf(target: Locator): Promise<Record<string, string>> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      wordSpacing: style.wordSpacing,
      fontFamily: style.fontFamily.split(",")[0]!.trim(),
    };
  });
}

/** Land on a question detail screen with a rendered preview, and let it settle. */
async function openPreview(page: Page, name: string): Promise<void> {
  // Multiple choice: it compiles to checkboxes, which are real descendants of the
  // carrier (see the header note on portalled overlays), and the checkbox is also the
  // control 032's interactivity round was fixed on, which exit criterion 4 re-checks.
  await createDraft(page, `e2e-island-${name}-${RUN}`, "Multiple choice");
  await expect(island(page)).toBeVisible();
  await settleTransitions(page);
}

/** Put the island into one theme and one mode through its own controls. */
async function setIsland(page: Page, theme: string, mode: string): Promise<void> {
  const switcher = page.getByTestId("qcms-preview-switcher");
  await chooseOption(switcher, THEME_LABEL, theme);
  await chooseOption(switcher, MODE_LABEL, mode);
  await settleTransitions(page);
}

test("the island paints the deployment's configured theme before anything is touched", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "first-paint");

  // The harness gives this dev server `QCMS_PORTAL_THEME=harbor`, the same non-default
  // value the portal dev server is given, so "the configured theme" is observable rather
  // than indistinguishable from the shipped base.
  expect(HARNESS_THEME).not.toBe("slate");
  const surface = island(page);
  await expect(surface).toHaveAttribute("data-theme", HARNESS_THEME);
  await expect(surface).toHaveClass(/\blight\b/);

  // ...and the attribute is not merely present: it resolves.
  const expected = THEMES[HARNESS_THEME as keyof typeof THEMES];
  expect(await token(surface, "--color-primary")).toBe(expected.primary);
  expect(await computed(surface, "background-color")).toBe(expected.background);
  expect(await computed(surface, "color")).toBe(expected.text);

  // Geometry, not only colour: the whole token set is re-declared on the carrier.
  expect(await token(surface, "--radius-control")).toBe(PORTAL_RADIUS_CONTROL);

  // The floors that the variables alone do not carry (see the header and TYPE_FLOORS).
  // Read as ONE object rather than five assertions so a probe that strips the carrier's
  // restatement reports every property it moved in a single run, instead of stopping at
  // the first - which is how the two non-discriminating members below were found.
  expect(await typeScaleOf(surface)).toEqual(TYPE_FLOORS);

  // NO island control resolves an authoring-app token. Read on a control INSIDE the
  // carrier rather than on the carrier itself, because inheritance is the mechanism
  // under test and the carrier is where the values are set.
  const control = surface.locator("[data-qcms-field]").first();
  await expect(control).toBeVisible();
  expect(await token(control, "--color-primary")).toBe(expected.primary);
  expect(await token(control, "--color-primary")).not.toBe(COBALT_LIGHT.primary);
  expect(await token(control, "--radius-control")).toBe(PORTAL_RADIUS_CONTROL);
  expect(await token(control, "--radius-control")).not.toBe(COBALT_LIGHT.radiusControl);

  // And the document root is untouched: the app is still wearing Cobalt.
  const root = page.locator("html");
  expect(await token(root, "--color-primary")).toBe(COBALT_LIGHT.primary);
  expect(await token(root, "--radius-control")).toBe(COBALT_LIGHT.radiusControl);
});

test("switching the island restyles the island only, in both directions", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "isolation");

  const surface = island(page);
  const topbar = page.locator(".qcms-topbar");
  const control = surface.locator("[data-qcms-field]").first();

  const topbarBefore = {
    background: await computed(topbar, "background-color"),
    color: await computed(topbar, "color"),
  };
  const islandBefore = {
    primary: await token(control, "--color-primary"),
    background: await computed(surface, "background-color"),
  };

  // Direction one: the island moves.
  await setIsland(page, "Plum", "Dark");

  const islandAfter = {
    primary: await token(control, "--color-primary"),
    background: await computed(surface, "background-color"),
  };
  // The island DID move, asserted against known values rather than "is different". This
  // is the half that makes the topbar check below load-bearing: without it, a switcher
  // that changed nothing would pass the identity assertion perfectly.
  expect(islandAfter.primary).toBe(PLUM_DARK.primary);
  expect(islandAfter.background).toBe(PLUM_DARK.background);
  expect(islandAfter.primary).not.toBe(islandBefore.primary);
  expect(islandAfter.background).not.toBe(islandBefore.background);

  // And the authoring chrome did not, byte for byte.
  expect(await computed(topbar, "background-color")).toBe(topbarBefore.background);
  expect(await computed(topbar, "color")).toBe(topbarBefore.color);
  expect(await token(page.locator("html"), "--color-primary")).toBe(COBALT_LIGHT.primary);

  // Direction two: the OPERATOR's own mode control moves, through the real menu rather
  // than by poking a class, and the island's selection survives it.
  await openMenu(appearanceTrigger(page));
  await page.getByRole("menuitemradio", { name: ADMIN_MODE_LABEL.dark, exact: true }).click();
  await expect(appearanceTrigger(page)).toHaveAccessibleName(
    `Appearance: ${ADMIN_MODE_LABEL.dark}`,
  );
  await settleTransitions(page);

  // The chrome moved (so the instrument was armed)...
  expect(await computed(topbar, "background-color")).not.toBe(topbarBefore.background);
  // ...and the island held its own selection, values included.
  await expect(surface).toHaveAttribute("data-theme", "plum");
  await expect(surface).toHaveClass(/\bdark\b/);
  expect(await token(control, "--color-primary")).toBe(PLUM_DARK.primary);
  expect(await computed(surface, "background-color")).toBe(PLUM_DARK.background);
});

test("every predefined theme and every mode is selectable, high contrast included", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "matrix");

  const surface = island(page);

  // All four themes, in the mode the island opens in.
  for (const [key, values] of Object.entries(THEMES)) {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    await setIsland(page, label, "Light");
    await expect(surface).toHaveAttribute("data-theme", key);
    expect(await token(surface, "--color-primary"), `${key} accent`).toBe(values.primary);
    expect(await computed(surface, "background-color"), `${key} background`).toBe(
      values.background,
    );
  }

  // All three modes, on one theme, so the mode layer is what varies.
  const MODE_LABELS = { light: "Light", dark: "Dark", hc: "High contrast" } as const;
  for (const [mode, values] of Object.entries(HARBOR_BY_MODE)) {
    await setIsland(page, "Harbor", MODE_LABELS[mode as keyof typeof MODE_LABELS]);
    expect(await token(surface, "--color-primary"), `harbor ${mode} accent`).toBe(values.primary);
    expect(await computed(surface, "background-color"), `harbor ${mode} background`).toBe(
      values.background,
    );
  }

  // High contrast is not only a palette: `theme-components.css` carries the TREATMENT
  // (heavy black control edges, flattened shadows), and until task 060 re-anchored that
  // sheet on the bare attribute it applied at `:root` only and could not reach an island
  // at all. So the treatment is asserted, not just the values it uses. The island is
  // still in Harbor + High contrast from the loop above.
  const box = surface.locator("label[data-rac] > div").first();
  await expect(box).toBeVisible();
  expect(await computed(box, "border-top-width")).toBe("2px");
  expect(await computed(box, "border-top-color")).toBe("rgb(0, 0, 0)");
});

test("a preview control still accepts input under a switched theme", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "interactive");

  // Dark harbor, exactly as exit criterion 4 words it.
  await setIsland(page, "Harbor", "Dark");

  const surface = island(page);
  const yes = surface.getByRole("checkbox", { name: "Yes, always", exact: true });
  const no = surface.getByRole("checkbox", { name: "No, never", exact: true });
  await expect(yes).not.toBeChecked();

  // Clicked by the visible label: react-aria puts a decorative indicator over the real
  // input, which intercepts pointer events (the convention `questions-lifecycle.pw.ts`
  // and `apps/portal/e2e/support/kitchen-sink.ts` both encode).
  await surface.getByText("Yes, always", { exact: true }).click();
  await expect(yes).toBeChecked();
  await surface.getByText("No, never", { exact: true }).click();
  await expect(no).toBeChecked();
  // The first is still ticked: multiChoice is a set, not a latched boolean, and a
  // re-render triggered by the theme attribute must not have reset the answers map.
  await expect(yes).toBeChecked();

  // And the theme survived the interaction rather than being reset by the state change.
  await expect(surface).toHaveAttribute("data-theme", "harbor");
  expect(await token(surface, "--color-primary")).toBe(HARBOR_BY_MODE.dark.primary);
});

test("the switcher is localized, keyboard-operable and shows focus", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "keyboard");

  const switcher = page.getByTestId("qcms-preview-switcher");
  // Localized: the accessible names are the catalog's strings, which is what an
  // assistive technology announces. A control labelled from a literal would still read
  // correctly to a sighted operator and be untranslatable (ADR-27).
  const themePicker = switcher.getByRole("button", { name: new RegExp(`${THEME_LABEL}$`) });
  const modePicker = switcher.getByRole("button", { name: new RegExp(`${MODE_LABEL}$`) });
  await expect(themePicker).toBeVisible();
  await expect(modePicker).toBeVisible();

  // Keyboard alone: reach the trigger, open it, move, commit. No pointer anywhere.
  //
  // Focus ARRIVES BY TAB rather than by `.focus()`, and that is load-bearing rather than
  // stylistic: `:focus-visible` is a heuristic about how focus was acquired, and Chromium
  // does not apply it to a button focused from script with no keyboard interaction behind
  // it. Measuring the ring after a programmatic focus therefore reports "no indicator" on
  // a control that indicates perfectly well for the operator this criterion is about. The
  // seek-and-return pair is what puts a real keyboard event in front of the focus.
  await themePicker.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(themePicker).toBeFocused();

  // A visible indicator on the focused control (WCAG 2.2 - 2.4.11), drawn either by the
  // shell's guaranteed `:focus-visible` rule or by the vendored control's own ring.
  const indicator = await themePicker.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      ring: style.boxShadow,
    };
  });
  expect(
    (indicator.outlineStyle !== "none" && indicator.outlineWidth !== "0px") ||
      indicator.ring !== "none",
    `the focused switcher trigger draws an indicator (${JSON.stringify(indicator)})`,
  ).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  // `End` rather than a count of ArrowDowns: it lands on the last option wherever the
  // listbox opened its focus, so this asserts the keyboard path rather than an
  // assumption about which item a react-aria `Select` focuses on open.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await settleTransitions(page);

  const surface = island(page);
  await expect(surface).toHaveAttribute("data-theme", "plum");
  expect(await token(surface, "--color-primary")).toBe(THEMES.plum.primary);
});

/**
 * The mixed states are the novel accessibility surface (exit criterion 5).
 *
 * Neither app has ever painted two palettes on one page before: the portal is one theme
 * per document and the authoring app is one mode per operator. What is new here is a
 * high-contrast respondent surface sitting inside a light authoring page, and the
 * reverse - and `color-contrast` is precisely the axe rule that can only be answered by
 * measuring the pixels that actually result.
 *
 * Both directions are analysed because they are different questions: one asks whether an
 * HC island reads correctly against light chrome, the other whether a light island reads
 * correctly while the operator's own chrome is in HC.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} [${violation.nodes
          .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
          .join(" | ")}]`,
    ),
    `axe violations with ${state}`,
  ).toEqual([]);
}

test("axe is green with the island and the chrome in opposite modes", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "axe");

  // Island in High contrast, chrome in Light.
  await setIsland(page, "Harbor", "High contrast");
  await expectNoViolations(page, "the island in high contrast and the chrome in light");

  // And the reverse: island in Light, chrome in High contrast, through the real menu.
  await setIsland(page, "Harbor", "Light");
  await openMenu(appearanceTrigger(page));
  await page.getByRole("menuitemradio", { name: ADMIN_MODE_LABEL.hc, exact: true }).click();
  await expect(appearanceTrigger(page)).toHaveAccessibleName(`Appearance: ${ADMIN_MODE_LABEL.hc}`);
  await settleTransitions(page);
  await expectNoViolations(page, "the island in light and the chrome in high contrast");
});
