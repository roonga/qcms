/* eslint-disable no-undef -- this module's one export is serialized into the browser by
   page.evaluate, so it reads DOM globals that Node never provides. */
// @ts-check
/** @param {string} attribute */
export function isHydrated(attribute) {
  return document.documentElement.hasAttribute(attribute);
}

/** @param {number} index */
export function cardHasSettled(index) {
  const card = document.querySelectorAll(".qcms-acard")[index];
  if (card === undefined) return true;
  const state = card.querySelector(".qcms-acard__head .qcms-acard__state")?.getAttribute("data-s");
  return state !== "running" && state !== "proposed";
}

/**
 * One read of everything the assistant panel shows, so the transcript and the error roll-up
 * describe the same moment on the page.
 */
export function readPanel() {
  /** @param {Element | null | undefined} node */
  const text = (node) =>
    node === null || node === undefined ? null : /** @type {HTMLElement} */ (node).innerText.trim();

  /** @param {Element} turn */
  const assistantTurn = (turn) => {
    const segments = turn.querySelector(".qcms-assistant__segments");
    if (segments === null) return [];
    const prose = [...segments.children]
      .filter((child) => !child.matches("details.qcms-assist-think, ol.qcms-assist-steps"))
      .map((child) => text(child))
      .filter((line) => line !== null && line !== "")
      .join("\n\n");
    return [
      {
        role: "assistant",
        text: prose,
        thinking: [...segments.querySelectorAll(".qcms-assist-think__body")].map((node) =>
          text(node),
        ),
        steps: [...segments.querySelectorAll(".qcms-assist-steps > li")].map((step) => ({
          label: text([...step.querySelectorAll("span")][1]),
          state: step.getAttribute("data-state"),
        })),
      },
    ];
  };

  /** @param {Element} step */
  const planStep = (step) => ({
    state: step.getAttribute("data-s"),
    title: text(step.querySelector(".qcms-acard__what")),
    details: text(step.querySelector(".qcms-acard__args")),
    notes: [...step.querySelectorAll(".qcms-acard__note")].map((note) => text(note)),
    issues: [...step.querySelectorAll(".qcms-acard__advisory li")].map((issue) => ({
      code: issue.getAttribute("data-issue-code"),
      message: text(issue),
    })),
    revealed: text(step.querySelector(".qcms-acard__reveal code")),
  });

  /**
   * `index` is the card's position among the cards on the page, which is what every later
   * step addresses it by.
   *
   * @param {Element} card
   * @param {number} index
   */
  const planCard = (card, index) => {
    const head = card.querySelector(".qcms-acard__head .qcms-acard__state");
    return {
      index,
      title: text(card.querySelector(".qcms-acard__title")),
      state: head?.getAttribute("data-s") ?? null,
      stateLabel: text(head),
      irreversible: text(card.querySelector('.qcms-acard__band[data-kind="irreversible"]')),
      reason: text(card.querySelector(".qcms-acard__reason q")),
      typedHint: text(card.querySelector(".qcms-acard__typed .qcms-field__hint")),
      result: text(card.querySelector(".qcms-acard__result")),
      steps: [...card.querySelectorAll(".qcms-acard__step")].map((step) => planStep(step)),
    };
  };

  return {
    context: text(document.querySelector('[data-testid="qcms-assistant-context"]')),
    panelError: text(document.querySelector('[data-testid="qcms-assistant-error"]')),
    turns: [...document.querySelectorAll('[data-testid="qcms-assistant-turns"] > li')].flatMap(
      (turn) =>
        turn.getAttribute("data-role") === "user"
          ? [{ role: "user", text: text(turn), thinking: [], steps: [] }]
          : assistantTurn(turn),
    ),
    cards: [...document.querySelectorAll(".qcms-acard")].map((card, index) =>
      planCard(card, index),
    ),
  };
}
