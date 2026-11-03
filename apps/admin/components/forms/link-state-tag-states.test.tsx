import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LinkState } from "../../lib/forms/types.ts";
import { stripTags } from "../test-support/markup.ts";

const { t } = await import("../../lib/i18n/en.ts");
const { linkStateKey } = await import("../../lib/forms/links.ts");
const { LinkStateTag } = await import("./link-state-tag.tsx");

const ALL_STATES: Readonly<Record<LinkState, true>> = {
  active: true,
  consumed: true,
  expired: true,
  revoked: true,
};

const STATES = Object.keys(ALL_STATES) as LinkState[];

function render(state: LinkState): string {
  return renderToStaticMarkup(<LinkStateTag state={state} />);
}

describe("the secure-link state chip renders every state the same way", () => {
  it.each(STATES)("%s spells its state out rather than relying on the tint", (state) => {
    const text = stripTags(render(state)).trim();

    expect(text, `${state} renders no word at all`).not.toBe("");
    expect(text).toBe(t(linkStateKey(state)));
  });

  it.each(STATES)("%s carries its own class modifier and machine-readable state", (state) => {
    const markup = render(state);

    expect(markup).toContain(`qcms-tag--link-${state}`);
    expect(markup).toContain(`data-state="${state}"`);
  });

  it("gives the four states four distinct words, so two are never told apart by tint alone", () => {
    const words = STATES.map((state) => stripTags(render(state)).trim());
    expect(new Set(words).size).toBe(STATES.length);
  });

  it("draws one markup path for all four, which is the whole genericity claim", () => {
    const skeletons = STATES.map((state) =>
      render(state)
        .replaceAll(`qcms-tag--link-${state}`, "qcms-tag--link-STATE")
        .replaceAll(`data-state="${state}"`, 'data-state="STATE"')
        .replace(t(linkStateKey(state)), "WORD"),
    );

    expect(new Set(skeletons).size, `four states rendered ${skeletons.join(" | ")}`).toBe(1);
  });
});
