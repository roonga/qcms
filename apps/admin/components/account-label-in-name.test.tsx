import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { initialsFor } from "@/lib/initials";

import { AccountMenu } from "./account-menu.tsx";

/**
 * WCAG 2.5.3 label-in-name for the topbar's account trigger (issue #1010).
 *
 * The criterion is one sentence: where a control carries visible text, that text is part
 * of its accessible name. This control paints an initials monogram and was named
 * "Account menu for dev@qcms.test", so for the account every documented deployment starts
 * with - `Administrator`, painted "AD" (`apps/api/src/features/auth/bootstrap.ts` supplies
 * that name when `QCMS_ADMIN_NAME` is unset) - the name and the button shared no
 * character. A speech-input operator saying "click AD" opened nothing, and a screen reader
 * announced a name no sighted colleague could point at.
 *
 * ## Why a table rather than one case
 *
 * Because the defect is a RELATIONSHIP between two derived strings, and it only shows up
 * for the account shapes where they fail to overlap by accident. The axe sweep already ran
 * `label-content-name-mismatch` over this button on every authenticated screen in three
 * modes and stayed green throughout, purely because its fixture's display name `E2E Admin`
 * yields "EA" and its address `e2e.<label>.<ts>@admin.test` happens to contain those two
 * letters once axe looks past the digits and dots. A test that fixed one account would
 * reproduce exactly that hole. So every shape the monogram can take is swept:
 *
 * - a display name, whose initials are absent from the address (the case that fails);
 * - no display name at all, where the initials come from the address and therefore always
 *   overlap it (the case that passed by construction, and must keep passing);
 * - the `Administrator` bootstrap default, which is the shipped one;
 * - a non-ASCII name, because `lib/initials.ts` segments by grapheme cluster and an
 *   accent is exactly the kind of character a "contains" comparison is careless with;
 * - a one-character result, where there is no second letter to carry the match.
 *
 * ## What is asserted, and in which direction
 *
 * The visible text is read back off the RENDERED button rather than taken from the
 * catalogue, so the assertion is independent of the message the fix edits: a catalogue
 * entry that lost its `{initials}` placeholder fails here, and so would a trigger that
 * started painting something else. `aria-hidden` subtrees are deliberately NOT stripped
 * when reading it, unlike the sweep in `forms/pin-label-in-name.test.tsx`: hiding text
 * from the accessibility tree does not unpaint it, and the criterion is about what a
 * sighted operator reads. That confusion is the one issue #1010 corrects.
 *
 * The name must START with the visible text, which is stronger than the criterion states
 * and is what speech input actually needs - a pronounceable prefix rather than a fragment
 * buried mid-sentence. The converse is asserted too: the email is still in the name, so a
 * "fix" that dropped it and left two letters announcing an account fails here.
 *
 * ## Why this layer
 *
 * An accessible name exists only once the component is rendered, so this needs a DOM. The
 * `name` option of a testing-library role query IS the computed name (dom-accessibility-api
 * under it, already a transitive dependency of `@testing-library/dom`), which is the same
 * computation Playwright's role engine uses. jsdom has no layout and nothing here needs
 * any: a name is not a measurement. The browser half rides in
 * `apps/admin/e2e/a11y-axe.pw.ts`, on an account chosen so the rule can actually fail.
 */

interface Shape {
  /** What the table is about, read out in the test name. */
  readonly what: string;
  readonly email: string;
  readonly name?: string;
  /** The monogram this shape must paint, stated here rather than derived. */
  readonly initials: string;
  /**
   * The exact code points of the monogram this shape paints, for the one row where the
   * encoding is the point.
   *
   * Comparing against `initials` compares two strings, and two strings differing only by
   * Unicode normalization are unequal - but the assertion does not SAY which form it
   * expects, so a formatter or editor that composed the source literal AND the
   * expectation together would leave the suite green while the decomposed case it exists
   * for had quietly vanished. A list of code points cannot be satisfied by an accident of
   * encoding, which is why it is stated separately from the string.
   */
  readonly codePoints?: readonly number[];
}

/**
 * Written as `\u` escapes rather than as typed letters, for the reason
 * `lib/initials.test.ts` gives: an editor or a formatter normalizes a typed accented
 * letter to its precomposed single-code-unit form, which is exactly the form that passes
 * on a broken grapheme implementation - so a literal here would quietly turn the
 * interesting case into the boring one. These two lines are the only place that risk
 * lives in this file, so the code points are spelled out.
 *
 * `o` + U+0301 uppercases to `O` + U+0301. `toUpperCase` leaves a decomposed letter
 * decomposed, so the monogram this shape expects is two clusters of two code points each,
 * NOT the precomposed U+00D3 U+00C1. The `codePoints` assertion on that row is what holds
 * the file to that: a normalization applied to these bytes fails the test rather than
 * quietly weakening it.
 */
const DECOMPOSED_NAME = "o\u0301lafur a\u0301sta";

const SHAPES: readonly Shape[] = [
  {
    what: "a two-part display name whose initials appear nowhere in the address",
    email: "dev@qcms.test",
    name: "Zoe Wren",
    initials: "ZW",
  },
  {
    what: "the Administrator bootstrap default",
    email: "dev@qcms.test",
    name: "Administrator",
    initials: "AD",
  },
  {
    what: "no display name, so the initials come from the address",
    email: "dev@qcms.test",
    initials: "DE",
  },
  {
    what: "a display name whose initials are non-ASCII",
    email: "dev@qcms.test",
    name: DECOMPOSED_NAME,
    initials: "O\u0301A\u0301",
    // U+004F U+0301 U+0041 U+0301: the assertion that keeps the line above decomposed.
    codePoints: [0x004f, 0x0301, 0x0041, 0x0301],
  },
  {
    what: "a one-character monogram",
    email: "x@qcms.test",
    name: "X",
    initials: "X",
  },
];

/** What a sighted operator can read on the control: its text, `aria-hidden` and all. */
function paintedText(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** `text` as a pattern matching an accessible name that begins with it. */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

/** `text` as a pattern matching an accessible name that carries it anywhere. */
function contains(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("the account trigger satisfies label-in-name (WCAG 2.5.3)", () => {
  for (const shape of SHAPES) {
    it(`names the trigger with the initials it paints: ${shape.what}`, () => {
      // Spread rather than `name={shape.name}`: `exactOptionalPropertyTypes` is on, so an
      // absent display name has to be an absent PROP, not a prop holding `undefined` -
      // which is also the shape the shell layout passes when the session carries no name.
      const container = render(
        <AccountMenu email={shape.email} {...(shape.name !== undefined && { name: shape.name })} />,
      ).container;
      const scope = within(container);
      const trigger = scope.getByRole("button");

      // The table's own claim about what this shape paints, so a change in `initialsFor`
      // shows up here as the defect it is rather than as a silently weaker assertion.
      const visible = paintedText(trigger);
      expect(visible).toBe(shape.initials);
      expect(initialsFor(shape.email, shape.name)).toBe(shape.initials);

      // Measured off the RENDERED text rather than off `shape.initials`, so this states
      // what reached the DOM: the source literal, `initialsFor`'s grapheme segmentation
      // and `toUpperCase` all have to keep the letter decomposed for it to hold.
      if (shape.codePoints !== undefined) {
        expect(
          [...visible].map((character) => character.codePointAt(0)),
          "the monogram lost its decomposed form somewhere between the source literal and the DOM",
        ).toEqual([...shape.codePoints]);
      }

      // The criterion, in the direction speech input needs it. Read from the rendered
      // button, so nothing about the catalogue message can satisfy this by construction.
      expect(scope.getAllByRole("button", { name: startsWith(visible) })).toContain(trigger);

      // And the name still says which account, which is why the control carries a label
      // at all: two letters alone name nothing an operator can act on.
      expect(scope.getAllByRole("button", { name: contains(shape.email) })).toContain(trigger);
    });
  }

  it("sweeps a shape whose initials the address cannot supply", () => {
    // The sweep above is only evidence while at least one row could actually fail: a
    // table where every monogram happens to occur in its address is the exact hole the
    // e2e fixture fell into, and it would pass unchanged against the pre-#1010 code.
    const falsifiable = SHAPES.filter(
      (shape) => !shape.email.toLowerCase().includes(shape.initials.toLowerCase()),
    );
    expect(falsifiable.map((shape) => shape.initials)).toContain("ZW");
  });
});
