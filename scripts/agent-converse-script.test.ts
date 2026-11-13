import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  asDirective,
  asEnvironment,
  cardAwaitingConfirmation,
  cardsOf,
  createSecretVault,
  DEFAULT_BASE_URL,
  DEFAULT_SCREEN,
  parseArgs,
  parseScriptFile,
  redactAddresses,
  resolveCredentials,
  resolveRun,
  runErrors,
  typedConfirmationValue,
} from "./agent-converse-script.mjs";

const EXAMPLE = fileURLToPath(new URL("agent-converse.example.json", import.meta.url));

describe("asDirective", () => {
  it("accepts the three directives", () => {
    expect(asDirective("confirm", "x")).toBe("confirm");
    expect(asDirective("decline", "x")).toBe("decline");
    expect(asDirective("leave", "x")).toBe("leave");
  });

  it("names the field and the allowed values when it refuses", () => {
    expect(() => asDirective("approve", "messages[2]")).toThrow(
      /messages\[2\].*confirm, decline, leave.*"approve"/su,
    );
  });
});

describe("parseArgs", () => {
  it("binds a directive to the ask before it", () => {
    const parsed = parseArgs(["--ask", "first", "--cards", "confirm", "--ask", "second"]);
    expect(parsed.asks).toEqual([{ text: "first", cards: "confirm" }, { text: "second" }]);
    expect(parsed.defaultCards).toBeUndefined();
  });

  it("reads a directive given before any ask as the run default", () => {
    const parsed = parseArgs(["--cards", "decline", "--ask", "first"]);
    expect(parsed.defaultCards).toBe("decline");
    expect(parsed.asks).toEqual([{ text: "first" }]);
  });

  it("reads the remaining options", () => {
    const parsed = parseArgs([
      "--base-url",
      "http://localhost:7140",
      "--form",
      "frm_sample_library",
      "--name",
      "probe",
      "--timeout",
      "90000",
      "--headed",
      "--keep-open",
    ]);
    expect(parsed).toMatchObject({
      baseUrl: "http://localhost:7140",
      formId: "frm_sample_library",
      name: "probe",
      timeoutMs: 90_000,
      headed: true,
      keepOpen: true,
    });
  });

  it("refuses an unknown option, a missing value and a timeout that is not a duration", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option: --nope/u);
    expect(() => parseArgs(["--ask"])).toThrow(/--ask requires a value/u);
    expect(() => parseArgs(["--timeout", "soon"])).toThrow(/positive number of milliseconds/u);
  });

  it("reads an environment name and refuses one the admin would not keep", () => {
    expect(parseArgs(["--environment", "test"]).environment).toBe("test");
    expect(() => parseArgs(["--environment", "Prod"])).toThrow(/lowercase name/u);
  });
});

describe("asEnvironment", () => {
  it("takes the admin's own wire vocabulary", () => {
    expect(asEnvironment("prod", "x")).toBe("prod");
    expect(asEnvironment("uat2", "x")).toBe("uat2");
  });

  it("names the field when it refuses, rather than falling back to prod", () => {
    expect(() => asEnvironment("2nd", "messages[0]")).toThrow(/messages\[0\].*lowercase/su);
    expect(() => asEnvironment(undefined, "x")).toThrow(/lowercase/u);
  });
});

describe("parseScriptFile", () => {
  it("reads strings and objects, and leaves an unstated directive open", () => {
    const parsed = parseScriptFile(
      JSON.stringify({
        screen: "/questions",
        messages: ["plain", { text: "confirmed", cards: "confirm" }],
      }),
      "script.json",
    );
    expect(parsed.screen).toBe("/questions");
    expect(parsed.messages).toEqual([{ text: "plain" }, { text: "confirmed", cards: "confirm" }]);
  });

  it("reads the committed example", () => {
    const parsed = parseScriptFile(readFileSync(EXAMPLE, "utf8"), EXAMPLE);
    expect(parsed.formId).toBe("frm_sample_library");
    expect(parsed.cards).toBe("leave");
    expect(parsed.messages.map((message) => message.cards)).toEqual([
      undefined,
      "confirm",
      "decline",
    ]);
  });

  it("names the file and the entry when it refuses", () => {
    expect(() => parseScriptFile("{", "script.json")).toThrow(/script\.json is not valid JSON/u);
    expect(() => parseScriptFile("[]", "script.json")).toThrow(/must hold a JSON object/u);
    expect(() => parseScriptFile(`{"messages":{}}`, "script.json")).toThrow(/"messages" array/u);
    expect(() => parseScriptFile(`{"messages":[{"text":" "}]}`, "script.json")).toThrow(
      /messages\[0\] needs a non-empty "text"/u,
    );
    expect(() => parseScriptFile(`{"messages":[{"text":"a","cards":"yes"}]}`, "s.json")).toThrow(
      /messages\[0\].*confirm, decline, leave/su,
    );
  });
});

describe("resolveRun", () => {
  const run = (args: readonly string[], file?: ReturnType<typeof parseScriptFile>) =>
    resolveRun({ cli: parseArgs(args), ...(file === undefined ? {} : { file }) });

  it("falls back to the library screen and the local admin", () => {
    const resolved = run(["--ask", "hello"]);
    expect(resolved).toMatchObject({
      baseUrl: DEFAULT_BASE_URL,
      screen: DEFAULT_SCREEN,
      messages: [{ text: "hello", cards: "leave" }],
    });
  });

  it("turns a form id into its builder screen and trims the base URL", () => {
    expect(
      run(["--base-url", "http://localhost:7040/", "--form", "frm_x", "--ask", "q"]),
    ).toMatchObject({ baseUrl: "http://localhost:7040", screen: "/forms/frm_x" });
  });

  it("takes the base URL from the environment when no flag gives one", () => {
    const resolved = resolveRun({
      cli: parseArgs(["--ask", "q"]),
      environment: { QCMS_ADMIN_BASE_URL: "http://localhost:7140" },
    });
    expect(resolved.baseUrl).toBe("http://localhost:7140");
  });

  it("prefers a per-message directive, then the run default, then the file default", () => {
    const file = parseScriptFile(
      JSON.stringify({ cards: "decline", messages: ["a", { text: "b", cards: "confirm" }] }),
      "s.json",
    );
    expect(run([], file).messages).toEqual([
      { text: "a", cards: "decline" },
      { text: "b", cards: "confirm" },
    ]);
    expect(run(["--cards", "leave"], file).messages).toEqual([
      { text: "a", cards: "leave" },
      { text: "b", cards: "confirm" },
    ]);
  });

  it("lets command-line asks replace the file's messages", () => {
    const file = parseScriptFile(JSON.stringify({ messages: ["from the file"] }), "s.json");
    expect(run(["--ask", "from the flag"], file).messages).toEqual([
      { text: "from the flag", cards: "leave" },
    ]);
  });

  it("takes an environment from the flag, then the file, then the environment", () => {
    const file = parseScriptFile(
      JSON.stringify({ environment: "staging", messages: ["a"] }),
      "s.json",
    );
    expect(run(["--environment", "test", "--ask", "q"]).environment).toBe("test");
    expect(run([], file).environment).toBe("staging");
    expect(
      resolveRun({
        cli: parseArgs(["--ask", "q"]),
        environment: { QCMS_AGENT_CONVERSE_ENVIRONMENT: "dev" },
      }).environment,
    ).toBe("dev");
  });

  it("names no environment when nothing does, so the admin keeps its own selection", () => {
    expect(run(["--ask", "q"]).environment).toBeUndefined();
    expect(
      resolveRun({
        cli: parseArgs(["--ask", "q"]),
        environment: { QCMS_AGENT_CONVERSE_ENVIRONMENT: "  " },
      }).environment,
    ).toBeUndefined();
  });

  it("refuses an empty run and two competing screens", () => {
    expect(() => run([])).toThrow(/--ask <text>, or --script <file>/u);
    expect(() => run(["--ask", "q", "--form", "frm_x", "--screen", "/questions"])).toThrow(
      /names two screens/u,
    );
  });
});

describe("resolveCredentials", () => {
  it("prefers the harness variables and carries an optional TOTP secret", () => {
    expect(
      resolveCredentials({
        QCMS_AGENT_CONVERSE_EMAIL: " a@admin.test ",
        QCMS_AGENT_CONVERSE_PASSWORD: "p",
        QCMS_ADMIN_EMAIL: "b@admin.test",
        QCMS_AGENT_CONVERSE_TOTP: " SEED ",
      }),
    ).toEqual({ email: "a@admin.test", password: "p", totpSecret: "SEED" });
  });

  it("falls back to the admin variables and omits an empty TOTP secret", () => {
    expect(
      resolveCredentials({
        QCMS_ADMIN_EMAIL: "b@admin.test",
        QCMS_ADMIN_PASSWORD: "p",
        QCMS_AGENT_CONVERSE_TOTP: "",
      }),
    ).toEqual({ email: "b@admin.test", password: "p" });
  });

  it("carries the password a forced first change should set", () => {
    expect(
      resolveCredentials({
        QCMS_ADMIN_EMAIL: "b@admin.test",
        QCMS_ADMIN_PASSWORD: "provisional",
        QCMS_AGENT_CONVERSE_NEW_PASSWORD: "chosen",
      }),
    ).toEqual({ email: "b@admin.test", password: "provisional", newPassword: "chosen" });
  });

  it("names every variable it looked at when none is set", () => {
    expect(() => resolveCredentials({ QCMS_ADMIN_EMAIL: "b@admin.test" })).toThrow(
      /QCMS_AGENT_CONVERSE_EMAIL.*QCMS_ADMIN_PASSWORD/su,
    );
  });
});

describe("the secret vault", () => {
  it("keeps one reference per value", () => {
    const vault = createSecretVault();
    expect(vault.hide("first", "v1")).toBe("secret-1");
    expect(vault.hide("again", "v1")).toBe("secret-1");
    expect(vault.hide("second", "v2")).toBe("secret-2");
    expect(vault.entries).toEqual([
      { ref: "secret-1", label: "first", value: "v1" },
      { ref: "secret-2", label: "second", value: "v2" },
    ]);
  });

  it("replaces a minted link address and leaves ordinary admin routes alone", () => {
    const vault = createSecretVault();
    const redacted = redactAddresses(
      "Open http://localhost:7000/s/8Fq2wRkTnLp4Zx9VmB3Qd7 or http://localhost:7040/forms/frm_x",
      vault,
      "turn 1",
    );
    expect(redacted).toBe("Open [secret-1] or http://localhost:7040/forms/frm_x");
    expect(vault.entries[0]).toMatchObject({
      label: "turn 1 address",
      value: "http://localhost:7000/s/8Fq2wRkTnLp4Zx9VmB3Qd7",
    });
  });

  it("passes absent text through", () => {
    expect(redactAddresses(null, createSecretVault(), "x")).toBeNull();
    expect(redactAddresses(undefined, createSecretVault(), "x")).toBeNull();
  });
});

describe("typedConfirmationValue", () => {
  it("reads the value the card demands", () => {
    expect(typedConfirmationValue("Type ses_7Q4 exactly.")).toBe("ses_7Q4");
  });

  it("gives nothing for a hint it does not recognise", () => {
    expect(typedConfirmationValue("Please confirm")).toBeUndefined();
  });
});

describe("runErrors", () => {
  it("is empty for a clean read-only turn", () => {
    expect(
      runErrors({
        turns: [{ user: "what is in this form?", panelError: null, replySteps: [], card: null }],
      }),
    ).toEqual([]);
  });

  it("passes a turn that produced no card, and still fails one the panel refused", () => {
    const turn = (panelError: string | null) => ({
      user: "what is in this form?",
      cardAction: "no card",
      cardIndex: null,
      panelError,
      replySteps: [],
      cards: [],
      card: null,
    });
    expect(runErrors({ turns: [turn(null)] })).toEqual([]);
    expect(runErrors({ turns: [turn("The assistant is not available.")] })).toEqual([
      { turn: 1, where: "panel", text: "The assistant is not available." },
    ]);
  });

  it("reports the panel's own error text", () => {
    expect(runErrors({ turns: [{ panelError: "The assistant is not available." }] })).toEqual([
      { turn: 1, where: "panel", text: "The assistant is not available." },
    ]);
  });

  it("reports a failed reply step by its label", () => {
    expect(
      runErrors({ turns: [{ replySteps: [{ label: "Reading the form", state: "failed" }] }] }),
    ).toEqual([
      {
        turn: 1,
        where: 'reply step "Reading the form"',
        text: "the assistant reported this step failed",
      },
    ]);
  });

  it("gives the page-visible reason for a failed plan step", () => {
    expect(
      runErrors({
        turns: [
          {
            card: {
              title: "Publish frm_x",
              result: "One step failed.",
              steps: [
                { state: "done", title: "Save the draft", notes: [], issues: [] },
                {
                  state: "failed",
                  title: "Publish to prod",
                  notes: ["There is no draft to publish."],
                  issues: [{ code: "UNPUBLISHED_QUESTION_PIN", message: "q_dob is a draft" }],
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        turn: 1,
        where: 'plan step 2 "Publish to prod"',
        text: "There is no draft to publish. / UNPUBLISHED_QUESTION_PIN: q_dob is a draft",
      },
    ]);
  });

  it("falls back to the card title and result when the step says nothing", () => {
    expect(
      runErrors({
        turns: [
          {
            card: {
              title: "Publish frm_x",
              result: "It did not run.",
              steps: [{ state: "failed" }],
            },
          },
        ],
      }),
    ).toEqual([{ turn: 1, where: 'plan step 1 "Publish frm_x"', text: "It did not run." }]);
  });

  it("says so when nothing on the page explains the failure", () => {
    expect(runErrors({ turns: [{ card: { title: "t", steps: [{ state: "failed" }] } }] })).toEqual([
      { turn: 1, where: 'plan step 1 "t"', text: "the step failed without saying why" },
    ]);
  });

  it("numbers errors by the turn they happened on", () => {
    expect(
      runErrors({ turns: [{ panelError: null }, { panelError: "Rate limited." }] }).map(
        (error) => error.turn,
      ),
    ).toEqual([2]);
  });

  it("reads a failure on the second of two cards in one turn", () => {
    expect(
      runErrors({
        turns: [
          {
            cards: [
              { index: 0, title: "Save the draft", steps: [{ state: "done" }] },
              {
                index: 1,
                title: "Publish frm_x",
                steps: [
                  { state: "failed", title: "Publish to prod", notes: ["Nothing to publish."] },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { turn: 1, where: 'card 2 plan step 1 "Publish to prod"', text: "Nothing to publish." },
    ]);
  });

  it("names the card only when a turn showed more than one", () => {
    const one = { index: 0, title: "Publish frm_x", steps: [{ state: "failed" }] };
    expect(runErrors({ turns: [{ cards: [one] }] })[0]?.where).toBe('plan step 1 "Publish frm_x"');
  });
});

describe("cardsOf", () => {
  it("prefers the cards array and drops anything that is not a card", () => {
    const first = { index: 0 };
    expect(cardsOf({ cards: [first, null, "no"], card: { index: 9 } })).toEqual([first]);
  });

  it("falls back to the single card field, and to nothing at all", () => {
    expect(cardsOf({ card: { index: 0 } })).toEqual([{ index: 0 }]);
    expect(cardsOf({ card: null })).toEqual([]);
    expect(cardsOf({})).toEqual([]);
  });
});

describe("cardAwaitingConfirmation", () => {
  it("picks the waiting card rather than the first one on the page", () => {
    expect(
      cardAwaitingConfirmation([
        { index: 0, state: "done" },
        { index: 1, state: "proposed" },
      ]),
    ).toEqual({ index: 1, state: "proposed" });
  });

  it("takes the earliest of several waiting cards", () => {
    expect(
      cardAwaitingConfirmation([
        { index: 0, state: "proposed" },
        { index: 1, state: "proposed" },
      ])?.["index"],
    ).toBe(0);
  });

  it("gives nothing when no card is waiting", () => {
    expect(cardAwaitingConfirmation([{ index: 0, state: "running" }])).toBeUndefined();
    expect(cardAwaitingConfirmation([])).toBeUndefined();
  });
});
