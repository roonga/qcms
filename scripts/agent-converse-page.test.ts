// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { readPanel } from "./agent-converse-page.mjs";

function card(steps: readonly string[]): string {
  const rows = steps
    .map(
      (title) =>
        `<li class="qcms-acard__step" data-s="done">${title === "" ? "" : `<span class="qcms-acard__what">${title}</span>`}<p class="qcms-acard__args"><span>Environment TEST</span></p></li>`,
    )
    .join("");
  return `<article class="qcms-acard"><header class="qcms-acard__head"><h2 class="qcms-acard__title">Create 1 test link for this form</h2><span class="qcms-acard__state" data-s="done">Done</span></header><ol>${rows}</ol></article>`;
}

/* jsdom lays nothing out, so it offers no innerText; the reader's own layout-sensitive trimming is
   the browser's job and not what these cases are about. */
Object.defineProperty(globalThis.HTMLElement.prototype, "innerText", {
  configurable: true,
  get(this: HTMLElement) {
    return this.textContent ?? "";
  },
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the panel a transcript reads", () => {
  it("reads a one-step card's heading as that step's title", () => {
    document.body.innerHTML = card([""]);
    const panel = readPanel() as { cards: { steps: { title: string | null }[] }[] };
    expect(panel.cards[0]?.steps[0]?.title).toBe("Create 1 test link for this form");
  });

  it("leaves a numbered step's own title alone", () => {
    document.body.innerHTML = card(["1. Publish version 1 of the question Full name", "2. Go"]);
    const panel = readPanel() as { cards: { steps: { title: string | null }[] }[] };
    expect(panel.cards[0]?.steps.map((step) => step.title)).toEqual([
      "1. Publish version 1 of the question Full name",
      "2. Go",
    ]);
  });
});
