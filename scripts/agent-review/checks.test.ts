import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cardsOf,
  cardTextOf,
  checkCardText,
  checkContradictions,
  checkEndState,
  checkProposals,
  checkSecrets,
  firstSentence,
  formatReport,
  main,
  reviewTranscript,
} from "./checks.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

function fixture(name: string): { turns: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8")) as {
    turns: Record<string, unknown>[];
  };
}

function scenario(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HERE, "scenarios", file), "utf8")) as Record<string, unknown>;
}

const SCENARIO_FILES = readdirSync(join(HERE, "scenarios")).filter((name) =>
  name.endsWith(".json"),
);

const PUBLISH = scenario("02-publish-and-test-link.json");

function checksFired(findings: readonly { check: string }[]): string[] {
  return [...new Set(findings.map((entry) => entry.check))].sort();
}

describe("the deterministic review of a transcript", () => {
  it("finds every fault in the session this harness was built for", () => {
    const result = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);

    expect(result.passed).toBe(false);
    expect(checksFired(result.findings)).toEqual([
      "budget.round-trips",
      "honesty.claimed-own-action",
      "honesty.claimed-without-run",
      "honesty.success-after-failure",
      "honesty.success-without-run",
      "honesty.unacknowledged-failure",
      "plan.duplicate-proposal",
      "plan.proposed-twice",
      "run.failed-step",
      "safety.secret-in-transcript",
      "voice.filler-opening",
      "voice.forbidden-term",
      "voice.identifier",
    ]);
  });

  it("names the builder words and the identifier it saw", () => {
    const { findings } = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);
    const words = findings.filter((entry) => entry.check === "voice.forbidden-term");

    expect(words.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("frm_"),
        expect.stringContaining("minted"),
        expect.stringContaining("slug"),
      ]),
    );
    expect(findings.find((entry) => entry.check === "voice.identifier")?.text).toContain(
      "frm_larkmead_signup",
    );
  });

  it("separates a second plan for finished work from one put up while another waits", () => {
    const { findings } = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);
    const waiting = findings.find((entry) => entry.check === "plan.proposed-twice");

    expect(waiting?.turn).toBe(2);
    expect(findings.find((entry) => entry.check === "plan.duplicate-proposal")?.turn).toBe(4);
    expect(findings.find((entry) => entry.check === "plan.duplicate-proposal")?.severity).toBe(
      "fail",
    );
  });

  it("will not call a persisting card a second plan when only one card was recorded", () => {
    const { findings } = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);
    const waiting = findings.find((entry) => entry.check === "plan.proposed-twice");

    expect(waiting?.severity).toBe("warn");
    expect(waiting?.text).toContain("one card per turn cannot show");

    const listed = checkProposals({
      turns: [
        { cards: [{ state: "proposed", steps: [{ title: "a", details: "b" }] }] },
        { cards: [{ state: "proposed", steps: [{ title: "a", details: "b" }] }] },
      ],
    });

    expect(listed[0]?.severity).toBe("fail");
  });

  it("passes a run that reached the same end in two turns", () => {
    const result = reviewTranscript(fixture("clean-session.transcript.json"), PUBLISH);

    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.turns).toBe(2);
  });

  it("reads one card per turn and a list of them the same way", () => {
    const one = { card: { state: "proposed", steps: [{ title: "a", details: "b" }] } };
    const many = { cards: [{ state: "proposed", steps: [{ title: "a", details: "b" }] }] };

    expect(cardsOf(one)).toEqual(cardsOf(many));
    expect(cardsOf({ card: null })).toEqual([]);
    expect(
      checkProposals({
        turns: [
          { card: { state: "done", steps: [{ title: "a", details: "b" }] } },
          { cards: [{ state: "proposed", steps: [{ title: "a", details: "b" }] }] },
        ],
      }),
    ).toHaveLength(1);
  });

  it("holds a one-time value back and says so without repeating it", () => {
    const { findings } = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);
    const secrets = findings.filter((entry) => entry.check === "safety.secret-in-transcript");

    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.evidence).toBe("<withheld>");
    expect(secrets[0]?.text).not.toContain("example-one-time-value");
  });

  it("flags an address left in a reply", () => {
    const leaked = {
      turns: [
        {
          reply: "Open https://forms.qcms.test/f/ABCDEFGHIJKLMNOPQRST to try it.",
          card: null,
        },
      ],
    };

    expect(checkSecrets(leaked).map((entry) => entry.check)).toEqual([
      "safety.secret-in-transcript",
    ]);
    expect(checkSecrets({ turns: [{ reply: "Open the link on the card.", card: null }] })).toEqual(
      [],
    );
  });

  it("names a failed step once, however many places showed it", () => {
    const { findings } = reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH);

    expect(findings.filter((entry) => entry.check === "run.failed-step")).toHaveLength(1);
  });

  it("takes the first sentence without swallowing the rest", () => {
    expect(firstSentence("Done. The link is on the card.")).toBe("Done.");
    expect(firstSentence("No link yet")).toBe("No link yet");
  });
});

describe("the card, which the person reads as closely as the reply", () => {
  const card = {
    title: "Plan, 2 steps",
    state: "proposed",
    reason: "A reply the harness copied onto the card.",
    result: "Done. The draft v1 is stored.",
    steps: [
      {
        state: "proposed",
        title: "1. Publish v1 of q_phone_number",
        details: "Question q_phone_number\nSlug phone-number",
        notes: ["The form uses an unpinned question."],
        issues: ["payload refused"],
      },
      { state: "proposed", title: "2. Put the form out on test", details: "Test, version 1" },
    ],
  };

  it("reads every piece the person sees and leaves the copied reply alone", () => {
    const pieces = cardTextOf(card);

    expect(pieces.map((piece) => piece.where)).toEqual([
      "the card title",
      "the card's outcome line",
      "step 1's title",
      "step 1's detail",
      "step 1's note",
      "step 1's advisory issue",
      "step 2's title",
      "step 2's detail",
    ]);
    expect(pieces.some((piece) => piece.text.includes("the harness copied"))).toBe(false);
    expect(pieces.filter((piece) => piece.title).map((piece) => piece.where)).toEqual([
      "the card title",
      "step 1's title",
      "step 2's title",
    ]);
  });

  it("names an identifier in a title apart from one buried in a detail", () => {
    const findings = checkCardText({ turns: [{ reply: "", cards: [card] }] });
    const titles = findings.filter((entry) => entry.check === "voice.id-in-title");
    const elsewhere = findings.filter((entry) => entry.check === "voice.card-identifier");

    expect(titles).toHaveLength(1);
    expect(titles[0]?.where).toBe("step 1's title");
    expect(titles[0]?.text).toContain("q_phone_number");
    expect(elsewhere.map((entry) => entry.where)).toEqual(["step 1's detail"]);
  });

  it("finds the builder words in a card's own words, wherever they sit", () => {
    const words = checkCardText({ turns: [{ reply: "", cards: [card] }] })
      .filter((entry) => entry.check === "voice.card-term")
      .map((entry) => `${entry.where}: ${entry.text}`);

    expect(words).toEqual(
      expect.arrayContaining([
        expect.stringContaining("outcome line"),
        expect.stringContaining("Slug"),
        expect.stringContaining("unpinned"),
        expect.stringContaining("payload"),
      ]),
    );
  });

  it("says nothing about a card written in the person's own words", () => {
    const plain = {
      title: "Put the form out on test",
      state: "proposed",
      result: null,
      steps: [
        {
          state: "proposed",
          title: "Put the Larkmead new patient sign-up out on test",
          details: "Test, version 1",
          notes: [],
          issues: [],
        },
      ],
    };

    expect(checkCardText({ turns: [{ reply: "", cards: [plain] }] })).toEqual([]);
  });
});

describe("the reply against what the cards show", () => {
  it("catches a claim of success in a turn where a step did not run", () => {
    const findings = checkContradictions({
      turns: [
        {
          reply: "The publish failed, but the form is now on test and the link is ready.",
          cardAction: "confirmed",
          cards: [{ state: "failed", steps: [{ state: "failed", title: "Put it out on test" }] }],
        },
      ],
    });

    expect(findings.map((entry) => entry.check)).toEqual([
      "honesty.success-after-failure",
      "honesty.success-after-failure",
    ]);
    expect(findings[0]?.text).toContain("is now on");
  });

  it("catches a claim of success before anything has run", () => {
    const findings = checkContradictions({
      turns: [
        {
          reply: "The form has now been published.",
          cardAction: "left waiting",
          cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Publish" }] }],
        },
      ],
    });

    expect(findings.map((entry) => entry.check)).toEqual(["honesty.success-without-run"]);
  });

  it("catches the denial of a card that is still waiting", () => {
    const findings = checkContradictions({
      turns: [
        {
          reply: "The plan is on your screen now.",
          cardAction: "left waiting",
          cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Publish" }] }],
        },
        {
          reply: "No earlier card of yours is waiting, so here is a fresh one.",
          cardAction: "left waiting",
          cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Publish" }] }],
        },
      ],
    });

    expect(findings.map((entry) => entry.check)).toEqual(["honesty.denied-a-waiting-card"]);
    expect(findings[0]?.turn).toBe(2);
    expect(findings[0]?.text).toContain("turn 1 left a card waiting");
  });

  it("stops denying a waiting card once that card has been confirmed", () => {
    expect(
      checkContradictions({
        turns: [
          {
            reply: "The plan is on your screen now.",
            cardAction: "left waiting",
            cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Publish" }] }],
          },
          {
            reply: "Both questions went out with it.",
            cardAction: "confirmed",
            cards: [{ state: "done", steps: [{ state: "done", title: "Publish" }] }],
          },
          { reply: "No card of yours is waiting.", cardAction: "no card", cards: [] },
        ],
      }),
    ).toEqual([]);
  });

  it("catches a card the reply says is waiting when the turn produced none", () => {
    const findings = checkContradictions({
      turns: [{ reply: "A card is waiting for your Confirm.", cardAction: "no card", cards: [] }],
    });

    expect(findings.map((entry) => entry.check)).toEqual(["honesty.claimed-a-waiting-card"]);
  });

  it("says nothing when the reply matches the cards", () => {
    expect(
      checkContradictions({
        turns: [
          {
            reply: "The plan below publishes the three questions, waiting for your Confirm.",
            cardAction: "confirmed",
            cards: [{ state: "done", steps: [{ state: "done", title: "Publish" }] }],
          },
          {
            reply: "The Larkmead new patient sign-up is now on test.",
            cardAction: "no card",
            cards: [],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("the end state, read back rather than taken from the reply", () => {
  const snapshot = {
    forms: [
      {
        title: "Larkmead new patient sign-up",
        questionCount: 5,
        ruleCount: 1,
        releases: [{ environment: "test", version: 1 }],
        links: [{ environment: "test", active: true }],
      },
    ],
  };

  it("accepts the state scenario 2 asks for", () => {
    expect(checkEndState(PUBLISH as never, snapshot)).toEqual([]);
  });

  it("fails on a second link, which is the fault the scenario exists for", () => {
    const twice = {
      forms: [
        {
          ...snapshot.forms[0],
          links: [
            { environment: "test", active: true },
            { environment: "test", active: true },
          ],
        },
      ],
    };
    const findings = checkEndState(PUBLISH as never, twice);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe("end-state.linkCount");
    expect(findings[0]?.text).toContain("found 2 link(s) in test, expected exactly 1");
  });

  it("fails when the form never reached test, and when it reached production", () => {
    const nothing = { forms: [{ ...snapshot.forms[0], releases: [] }] };
    const live = {
      forms: [
        {
          ...snapshot.forms[0],
          releases: [
            { environment: "test", version: 1 },
            { environment: "production", version: 1 },
          ],
        },
      ],
    };

    expect(checksFired(checkEndState(PUBLISH as never, nothing))).toEqual(["end-state.released"]);
    expect(checksFired(checkEndState(PUBLISH as never, live))).toEqual(["end-state.notReleased"]);
  });

  it("says so when the form is not there at all", () => {
    expect(checksFired(checkEndState(PUBLISH as never, { forms: [] }))).toEqual([
      "end-state.missing-form",
    ]);
  });

  it("refuses an assertion it does not implement", () => {
    const made = {
      expect: { endState: [{ check: "vibes", title: "Larkmead new patient sign-up" }] },
    };

    expect(checkEndState(made, snapshot)[0]?.check).toBe("end-state.unknown-check");
  });
});

describe("the scenario files", () => {
  it("has one for each failure the real session showed", () => {
    expect(SCENARIO_FILES).toHaveLength(7);
  });

  it.each(SCENARIO_FILES)("%s is a runnable script with a budget and an end state", (file) => {
    const spec = scenario(file) as {
      id?: string;
      goal?: string;
      messages?: { text?: string; cards?: string }[];
      budget?: { turns?: number };
      expect?: { endState?: unknown[]; assistantMust?: unknown[] };
      seed?: { reset?: string };
    };

    expect(spec.id).toMatch(/^[a-z][a-z0-9-]*$/u);
    expect(spec.goal?.length).toBeGreaterThan(20);
    expect(spec.seed?.reset).toMatch(/^(fresh|after:[a-z][a-z0-9-]*)$/u);
    expect(spec.budget?.turns).toBeGreaterThan(0);
    expect(spec.expect?.endState?.length).toBeGreaterThan(0);
    expect(spec.expect?.assistantMust?.length).toBeGreaterThan(0);

    expect(spec.messages?.length).toBeGreaterThan(0);
    for (const message of spec.messages ?? []) {
      expect(message.text?.trim()).not.toBe("");
      expect(["confirm", "decline", "leave"]).toContain(message.cards);
    }
    expect(spec.messages?.length).toBeLessThanOrEqual(spec.budget?.turns ?? 0);
  });

  it.each(SCENARIO_FILES)("%s asserts only end-state checks that exist", (file) => {
    const spec = scenario(file);

    expect(checkEndState(spec, { forms: [] }).map((entry) => entry.check)).not.toContain(
      "end-state.unknown-check",
    );
  });

  it("names a reset that another scenario leaves behind", () => {
    const ids = new Set(SCENARIO_FILES.map((file) => String(scenario(file)["id"])));

    for (const file of SCENARIO_FILES) {
      const reset = String((scenario(file)["seed"] as { reset?: string }).reset);
      if (reset !== "fresh") expect(ids).toContain(reset.replace("after:", ""));
    }
  });
});

describe("the command line a reviewer runs", () => {
  const scenarioFile = join(HERE, "scenarios", "02-publish-and-test-link.json");

  it("exits 1 on the bad session and 0 on the clean one", () => {
    expect(main([scenarioFile, join(HERE, "fixtures", "bad-session.transcript.json")])).toBe(1);
    expect(main([scenarioFile, join(HERE, "fixtures", "clean-session.transcript.json")])).toBe(0);
  });

  it("asks for its two files rather than guessing", () => {
    expect(main([])).toBe(2);
    expect(main([scenarioFile])).toBe(2);
  });

  it("leads the report with the verdict and keeps evidence withheld", () => {
    const report = formatReport(reviewTranscript(fixture("bad-session.transcript.json"), PUBLISH));

    expect(report.split("\n")[0]).toContain("publish-and-test-link: FAIL in 5 turn(s)");
    expect(report).toContain("<withheld>");
    expect(report).not.toContain("example-one-time-value");
  });
});
