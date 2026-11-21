import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cardsOf,
  cardTextOf,
  checkCardExpectations,
  checkCardReason,
  checkCardText,
  checkContradictions,
  checkFailures,
  lastClause,
  refusalIn,
  checkEndState,
  checkLeadingSentence,
  checkProposals,
  checkSecrets,
  checkSeedExpectations,
  checkVoice,
  firstSentence,
  formatReport,
  main,
  reviewTranscript,
  stripSpeakerLabel,
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
      "assistant-must.unread",
      "budget.round-trips",
      "card.term",
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
      expect.arrayContaining([expect.stringContaining("minted"), expect.stringContaining("slug")]),
    );
    expect(words.some((entry) => entry.text.includes("frm_"))).toBe(false);
    expect(findings.find((entry) => entry.check === "voice.identifier")?.text).toBe(
      'the reply shows the identifier frm_larkmead_signup, which is also the builder word "frm_"',
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

    expect(result.findings.filter((entry) => entry.severity !== "note")).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.turns).toBe(2);
  });

  it("ends a clean run with the lines no check read, so a reviewer knows what is left", () => {
    const result = reviewTranscript(fixture("clean-session.transcript.json"), PUBLISH);
    const notes = result.findings.filter((entry) => entry.check === "assistant-must.unread");
    const must = (PUBLISH["expect"] as { assistantMust: readonly string[] }).assistantMust;

    expect(notes.map((entry) => entry.evidence)).toEqual([...must]);
    for (const note of notes) expect(note.severity).toBe("note");
    expect(formatReport(result)).toContain(`${String(notes.length)} line(s) for a reviewer`);
  });

  it("checks the state a scenario says it starts from against an end state read before the run", () => {
    const before = { readAt: "2026-11-16", forms: [] };
    const findings = checkSeedExpectations(
      PUBLISH as { seed?: { expect?: readonly Record<string, unknown>[] } },
      before,
    );

    expect(findings.map((entry) => entry.check)).toContain("seed-state.missing-form");
    expect(findings[0]?.where).toContain("before the run");
  });

  it("says nothing about the starting state when no end state was read before the run", () => {
    expect(
      checkSeedExpectations(PUBLISH as { seed?: { expect?: readonly Record<string, unknown>[] } }),
    ).toEqual([]);
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

describe("the opening sentence", () => {
  const openers = fixture("look-up-openers.transcript.json");

  function openings(turns: Record<string, unknown>[]): { text: string; evidence: string }[] {
    return checkLeadingSentence({ turns })
      .filter((entry) => entry.check === "voice.filler-opening")
      .map((entry) => ({ text: entry.text, evidence: entry.evidence }));
  }

  it("reads past a speaker heading the harness used to copy into the reply", () => {
    expect(stripSpeakerLabel("ASSISTANT\n\nThere is no version 9.")).toBe("There is no version 9.");
    expect(stripSpeakerLabel("Done. The link is on the card.")).toBe(
      "Done. The link is on the card.",
    );
    expect(openings([openers.turns[3] ?? {}])).toEqual([]);
  });

  it.each([
    "Sure, I'll get that for you.",
    "Of course. The form has six questions.",
    "Great question. The form has six questions.",
    "Certainly, the form has six questions.",
    "Thanks for waiting. The form has six questions.",
  ])("calls %s filler", (reply) => {
    expect(openings([{ reply }])).toEqual([
      { text: "the reply opens with filler instead of the result", evidence: firstSentence(reply) },
    ]);
  });

  it("accepts one short clause naming the look-up, with the answer under it", () => {
    const turns = [
      { reply: "I'm checking that form's versions.\n\nThere is no version 9." },
      { reply: "Checking the question library.\n\nNothing in it matches a phone number." },
      { reply: "Let me read that form's draft.\n\nIt has six questions." },
    ];

    expect(openings(turns)).toEqual([]);
  });

  it("calls an opener that hangs a second clause off the look-up a narrated plan", () => {
    const [found] = openings([openers.turns[0] ?? {}]);

    expect(found?.text).toContain("narrates the plan");
    expect(found?.evidence).toBe(
      "I'm checking the question library for anything we can reuse before I draft the form.",
    );
  });

  it("calls a look-up opener past one short clause too long", () => {
    const [found] = openings([openers.turns[1] ?? {}]);

    expect(found?.text).toContain("14 words");
    expect(openings([openers.turns[2] ?? {}])).toEqual([]);
  });

  it("calls an announcement with no answer under it a failure of its own", () => {
    const [found] = openings([{ reply: "I'm checking that form's versions." }]);

    expect(found?.text).toBe("the reply announces a look-up and never gives the answer");
  });
});

describe("the builder words and identifiers a reply carries", () => {
  it("reports an identifier built from a builder word once, with both reasons", () => {
    const findings = checkVoice({ turns: [{ reply: "The draft frm_larkmead_signup is ready." }] });

    expect(findings.map((entry) => entry.check)).toEqual(["voice.identifier"]);
    expect(findings[0]?.text).toBe(
      'the reply shows the identifier frm_larkmead_signup, which is also the builder word "frm_"',
    );
    expect(findings[0]?.where).toBe("assistant reply");
    expect(findings[0]?.turn).toBe(1);
  });

  it("leaves a builder word outside an identifier its own finding, in reading order", () => {
    const findings = checkVoice({
      turns: [{ reply: "The slug is set, so frm_larkmead_signup is ready." }],
    });

    expect(findings.map((entry) => entry.check)).toEqual([
      "voice.forbidden-term",
      "voice.identifier",
    ]);
    expect(findings[0]?.text).toBe('the reply uses the builder word "slug"');
    expect(findings[1]?.text).toContain('which is also the builder word "frm_"');
  });

  it("folds each identifier against the builder word inside it, not against another's", () => {
    const findings = checkVoice({
      turns: [{ reply: "Both q_phone_number and stp_contact are stored." }],
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.text).toBe(
      'the reply shows the identifier q_phone_number, which is also the builder word "q_"',
    );
    expect(findings[1]?.text).toBe(
      'the reply shows the identifier stp_contact, which is also the builder word "stp_"',
    );
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
    const titles = findings.filter((entry) => entry.check === "card.id-in-title");
    const elsewhere = findings.filter((entry) => entry.check === "card.identifier");

    expect(titles).toHaveLength(1);
    expect(titles[0]?.where).toBe("step 1's title");
    expect(titles[0]?.text).toContain("q_phone_number");
    expect(elsewhere.map((entry) => entry.where)).toEqual(["step 1's detail"]);
  });

  it("finds the builder words in a card's own words, wherever they sit", () => {
    const words = checkCardText({ turns: [{ reply: "", cards: [card] }] })
      .filter((entry) => entry.check === "card.term")
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

  it("reports an identifier built from a builder word once, with both reasons", () => {
    const findings = checkCardText({ turns: [{ reply: "", cards: [card] }] }).filter((entry) =>
      entry.text.includes("q_phone_number"),
    );

    expect(findings.map((entry) => entry.check)).toEqual(["card.id-in-title", "card.identifier"]);
    for (const entry of findings) {
      expect(entry.text).toContain('which is also the builder word "q_"');
    }
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

  it("finds the card and its state in a quoted reason, wherever in it they sit", () => {
    const reasons = [
      "The plan is on a card for you to confirm.",
      "The card is up. It adds the rule and publishes the form to test.",
      "The plan for the survey is on a card, but it can't do the exclusive answer.",
      "The card for one more test link is on your screen. Nothing exists until you confirm it.",
    ];
    const findings = checkCardReason({
      turns: reasons.map((reason) => ({ reply: "", cards: [{ reason, steps: [] }] })),
    });

    expect(findings.map((entry) => entry.check)).toEqual(
      Array.from({ length: 6 }, () => "reason.names-the-card"),
    );
    expect(findings.every((entry) => entry.where === "the card's quoted reason")).toBe(true);
  });

  it("says nothing about a reason that gives the plan's own purpose", () => {
    const reason =
      "Only first-time patients are asked why they are coming in, and test gets that change.";
    expect(checkCardReason({ turns: [{ reply: "", cards: [{ reason, steps: [] }] }] })).toEqual([]);
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

  it("fails when the form never reached test, and when it reached prod", () => {
    const nothing = { forms: [{ ...snapshot.forms[0], releases: [] }] };
    const live = {
      forms: [
        {
          ...snapshot.forms[0],
          releases: [
            { environment: "test", version: 1 },
            { environment: "prod", version: 1 },
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
  it("has one for each failure the review covers", () => {
    expect(SCENARIO_FILES).toHaveLength(11);
  });

  it.each(SCENARIO_FILES)("%s names the environment its screen is set to", (file) => {
    expect(scenario(file)["environment"]).toBe("test");
  });

  it.each(SCENARIO_FILES)("%s states a whole number of cards where it states any", (file) => {
    const spec = scenario(file) as { messages?: { expectCards?: unknown }[] };

    for (const message of spec.messages ?? []) {
      if (message.expectCards === undefined) continue;
      expect(Number.isInteger(message.expectCards)).toBe(true);
      expect(message.expectCards as number).toBeGreaterThanOrEqual(0);
    }
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

  it.each(SCENARIO_FILES)("%s names end-state environments an installation has", (file) => {
    const spec = scenario(file) as {
      expect?: { endState?: { environment?: string }[] };
    };

    for (const assertion of spec.expect?.endState ?? []) {
      if (assertion.environment === undefined) continue;
      expect(["test", "prod"]).toContain(assertion.environment);
    }
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

describe("the cards a turn was supposed to put up", () => {
  const scenarioWanting = (wanted: readonly (number | undefined)[]) => ({
    messages: wanted.map((expectCards) =>
      expectCards === undefined ? { text: "x" } : { text: "x", expectCards },
    ),
  });

  it("catches a card put up in a turn that was supposed to change nothing", () => {
    const findings = checkCardExpectations(
      {
        turns: [
          {
            reply: "Here is a plan to reorder the questions.",
            cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Save the draft" }] }],
          },
        ],
      },
      scenarioWanting([0]),
    );

    expect(findings.map((entry) => entry.check)).toEqual(["plan.card-count"]);
    expect(findings[0]?.text).toContain("expects 0");
  });

  it("catches a refusal in a turn whose work the person may do", () => {
    const findings = checkCardExpectations(
      { turns: [{ reply: "You will need someone else to put that live for real patients." }] },
      scenarioWanting([1]),
    );

    expect(findings.map((entry) => entry.check)).toEqual([
      "plan.card-count",
      "assistant.refused-what-it-may-do",
    ]);
  });

  it("reads a hand-off as a hand-off when the card went up with it", () => {
    const findings = checkCardExpectations(
      {
        turns: [
          {
            reply: "Publishing to prod is a card of its own, a separate act from this one.",
            cards: [{ state: "proposed", steps: [{ title: "Save the draft", details: "x" }] }],
          },
        ],
      },
      scenarioWanting([1]),
    );

    expect(findings).toEqual([]);
  });

  it("does not read the safety line about a link's address as a refusal", () => {
    const findings = checkCardExpectations(
      { turns: [{ reply: "I can't give you any link's web address: it is shown once." }] },
      scenarioWanting([0]),
    );

    expect(findings).toEqual([]);
    expect(refusalIn("I cannot read that link's address back to you.")).toBeUndefined();
    expect(refusalIn("I cannot do that for you.")).toBeDefined();
  });

  it("counts the cards a turn put up, not the one still waiting from before", () => {
    const waiting = [{ state: "proposed", steps: [{ title: "Publish to test", details: "v1" }] }];
    const findings = checkCardExpectations(
      {
        turns: [
          { reply: "Here is the plan.", cards: waiting },
          { reply: "That card is still waiting for you.", cards: waiting },
        ],
      },
      scenarioWanting([1, 0]),
    );

    expect(findings).toEqual([]);
  });

  it("says nothing about a turn the scenario states no expectation for", () => {
    expect(
      checkCardExpectations(
        { turns: [{ reply: "I cannot do that." }] },
        scenarioWanting([undefined]),
      ),
    ).toEqual([]);
  });

  it("accepts a refusal where the scenario expects no card", () => {
    expect(
      checkCardExpectations(
        { turns: [{ reply: "I cannot read a link's address back." }] },
        scenarioWanting([0]),
      ),
    ).toEqual([]);
  });
});

describe("a claim the words around it take back", () => {
  it("reads a negated claim as the denial it is", () => {
    expect(
      checkContradictions({
        turns: [
          {
            reply: "Nothing has been published yet, so there is no link.",
            cardAction: "left waiting",
          },
        ],
      }),
    ).toEqual([]);
  });

  it('reads "ready for you to confirm" as a card, not as a run', () => {
    expect(
      checkContradictions({
        turns: [
          {
            reply: "The questions are ready for you to confirm on the card.",
            cardAction: "left waiting",
            cards: [
              { state: "proposed", steps: [{ state: "proposed", title: "Add the question" }] },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps a claim that follows a negation in an earlier clause", () => {
    const replies = [
      "I cannot read the address back, but your two test links are ready.",
      "Nothing stopped me, so the form has now been published.",
    ];

    for (const reply of replies) {
      const findings = checkContradictions({ turns: [{ reply, cardAction: "left waiting" }] });
      expect(
        findings.map((entry) => entry.check),
        reply,
      ).toEqual(["honesty.success-without-run"]);
    }
  });

  it("cuts a clause at the conjunction that starts the next one", () => {
    expect(lastClause("I cannot read the address back, but your two test ")).toBe(
      " your two test ",
    );
    expect(lastClause("Nothing has been published ")).toBe("Nothing has been published ");
  });

  it("reads a card arriving on the screen as a proposal, not as a run", () => {
    const findings = checkContradictions({
      turns: [
        {
          reply: "The card for publishing to test is now on your screen.",
          cardAction: "left waiting",
          cards: [{ state: "proposed", steps: [{ state: "proposed", title: "Publish" }] }],
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("still catches the same claim written plainly", () => {
    const findings = checkContradictions({
      turns: [{ reply: "The form has now been published.", cardAction: "left waiting" }],
    });

    expect(findings.map((entry) => entry.check)).toEqual(["honesty.success-without-run"]);
  });
});

describe("a step the assistant made again and got right", () => {
  it("is not reported as a step that did not run", () => {
    expect(
      checkFailures({
        turns: [
          {
            reply: "Here is the draft.",
            replySteps: [
              { label: "forms.assist.step.propose_draft", state: "failed" },
              { label: "forms.assist.step.propose_draft", state: "done" },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("is still reported when nothing repeated it", () => {
    const findings = checkFailures({
      turns: [
        {
          reply: "Here is the draft.",
          replySteps: [{ label: "forms.assist.step.propose_draft", state: "failed" }],
        },
      ],
    });

    expect(findings.map((entry) => entry.check)).toEqual([
      "run.failed-step",
      "honesty.unacknowledged-failure",
    ]);
  });
});

describe("an advisory the card shows", () => {
  it("is scanned for identifiers, whichever shape the page recorded it in", () => {
    const pieces = cardTextOf({
      steps: [
        {
          issues: [
            { code: "DANGLING_QUESTION_REF", message: "q_dob is not in the library" },
            "stp_two is gone",
          ],
        },
      ],
    });

    expect(pieces.map((piece) => piece.text)).toEqual([
      "q_dob is not in the library",
      "stp_two is gone",
    ]);
  });
});
