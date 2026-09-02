import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LinkState } from "../../lib/forms/types.ts";
import { stripTags } from "../test-support/markup.ts";

/**
 * Every secure-link chip state, rendered (issue 278).
 *
 * ## What the gap actually was
 *
 * Task 034's screenshot gate and axe sweep reach **Active** and **Revoked** and nothing
 * else. **Consumed** and **Expired** are never rendered anywhere in the suite, because
 * reaching them through the product needs a respondent session to spend a one-time link
 * and a clock to carry one past its expiry. The issue asked for one of two answers: build
 * that machinery, or record that `LinkStateTag` is structurally generic so per-state
 * rendering proves nothing the other two states have not already proven.
 *
 * This is the second answer, made checkable rather than asserted in prose. The component
 * is one markup path parameterised by the state: one class modifier, one `data-state`, one
 * catalogue lookup for the word. So the claim "a state nobody has photographed renders the
 * same way as one that has been" is a property of the markup, and the last test below is
 * that property stated directly - the four renders are byte-identical once the state token
 * is taken out of them.
 *
 * ## Why not a browser fixture
 *
 * A respondent session and a controlled clock would put Consumed and Expired in front of
 * axe and a camera, at the cost of a fixture that exists only to reach two values of one
 * enum. The states are derived by the API, not by this component
 * (`apps/api/src/features/links/handler.ts`), and that derivation is exercised over all
 * four in `links.integration.test.ts`. Between that and this, both halves of the chip -
 * which state the API says a link is in, and what the app draws for a given state - are
 * covered for every state, with no browser machinery in either.
 *
 * The contrast half lives in `link-state-tag.test.ts`, which computes each tint's ratio in
 * all three modes off the shipped stylesheets. That file answers "is the colour legible";
 * this one answers "is the markup the same".
 */

const { t } = await import("../../lib/i18n/en.ts");
const { linkStateKey } = await import("../../lib/forms/links.ts");
const { LinkStateTag } = await import("./link-state-tag.tsx");

/**
 * Every state, EXHAUSTIVE BY CONSTRUCTION.
 *
 * `Record<LinkState, true>` is the same trick `form-builder.tsx` uses for its pause
 * messages: a fifth member of the union is a compile error here until it is listed, so a
 * state cannot be added to the product and left unrendered by this file.
 */
const ALL_STATES: Readonly<Record<LinkState, true>> = {
  active: true,
  consumed: true,
  expired: true,
  revoked: true,
};

// `Object.keys` is typed `string[]` however narrow the record is, and the record above is
// the thing that makes this list total: its keys ARE `LinkState` by construction.
const STATES = Object.keys(ALL_STATES) as LinkState[];

/** The chip's markup for one state. */
function render(state: LinkState): string {
  return renderToStaticMarkup(<LinkStateTag state={state} />);
}

describe("the secure-link state chip renders every state the same way", () => {
  it.each(STATES)("%s spells its state out rather than relying on the tint", (state) => {
    const text = stripTags(render(state)).trim();

    // WCAG 1.4.1: colour is never the only signal, in any mode. This is the assertion that
    // fails if a state is ever drawn as a bare dot, and it covers the two states no
    // screenshot has ever shown.
    expect(text, `${state} renders no word at all`).not.toBe("");
    expect(text).toBe(t(linkStateKey(state)));
  });

  it.each(STATES)("%s carries its own class modifier and machine-readable state", (state) => {
    const markup = render(state);

    // The class the stylesheet tints, and the attribute `responses-ops.pw.ts` and the axe
    // sweep address rows by. Both are derived from the same argument, which is why a state
    // cannot arrive styled but unaddressable, or the reverse.
    expect(markup).toContain(`qcms-tag--link-${state}`);
    expect(markup).toContain(`data-state="${state}"`);
  });

  it("gives the four states four distinct words, so two are never told apart by tint alone", () => {
    const words = STATES.map((state) => stripTags(render(state)).trim());
    expect(new Set(words).size).toBe(STATES.length);
  });

  it("draws one markup path for all four, which is the whole genericity claim", () => {
    // Substituting the state token out of each render should leave the same string. If it
    // does, then Active and Revoked having been swept and photographed says exactly as
    // much about Consumed and Expired, and the fixtures issue 278 weighed would have
    // photographed a fifth and sixth copy of one template.
    const skeletons = STATES.map((state) =>
      render(state)
        .replaceAll(`qcms-tag--link-${state}`, "qcms-tag--link-STATE")
        .replaceAll(`data-state="${state}"`, 'data-state="STATE"')
        .replace(t(linkStateKey(state)), "WORD"),
    );

    expect(new Set(skeletons).size, `four states rendered ${skeletons.join(" | ")}`).toBe(1);
  });
});
