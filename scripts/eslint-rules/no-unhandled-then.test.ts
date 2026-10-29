import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import { noUnhandledThen } from "./no-unhandled-then.mjs";

/**
 * `RuleTester` runs its cases as soon as `run` is called, so each call sits inside an
 * `it` and a failure names the case. Vitest's globals are off here, so `RuleTester`
 * finds no `describe` to delegate to and executes the cases inline.
 */

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

const THE_352_SHAPE = `
  const runPublish = () => {
    startTransition(() => {
      void publish().then((state) => {
        setPublished(state);
        setDialog(null);
      });
    });
  };
`;

describe("qcms/no-unhandled-then", () => {
  it("reports a discarded chain that ends in .then with no rejection handler", () => {
    ruleTester.run("no-unhandled-then", noUnhandledThen as never, {
      valid: [],
      invalid: [
        { code: THE_352_SHAPE, errors: [{ messageId: "unhandledThen" }] },
        {
          code: `void copyRecoveryCodes(clipboard, codes).then((outcome) => { setNote(outcome); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        {
          code: `void inFlight.then(() => { inFlight = undefined; scheduleNext(); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        {
          code: `publish().then((state) => { setPublished(state); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        // A `.finally` is not a rejection handler, so the `.then` under it still is one.
        {
          code: `void publish().then(onOk).finally(() => { setBusy(false); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        // A `.catch` that is not last leaves the trailing `.then` unhandled.
        {
          code: `void publish().catch(onFail).then(onOk);`,
          errors: [{ messageId: "unhandledThen" }],
        },
        {
          code: `void navigator.clipboard?.writeText(id).then(() => { announce(); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        {
          code: `void publish()["then"]((state) => { setPublished(state); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
      ],
    });
  });

  it("is silent on a chain that handles its rejection, and on one nobody discards", () => {
    ruleTester.run("no-unhandled-then", noUnhandledThen as never, {
      valid: [
        `void publish().then((state) => { setPublished(state); }).catch(() => { setPublished(failed); });`,
        `void Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(() => { announce(copied); }).catch(() => { announce(failed); });`,
        `void navigator.clipboard?.writeText(id).then(() => { announce(copied); }, () => {});`,
        `void publish().then(onOk).catch(onFail).finally(() => { setBusy(false); });`,
        `async function f() { try { await publish().then(onOk); } catch { report(); } }`,
        `function f() { return publish().then(onOk); }`,
        `const settled = publish().then(onOk);`,
        // Fire-and-forget with no `.then` is deliberately not this rule's concern.
        `void send();`,
        `void page.route("**/*", handler);`,
        // A spread cannot be counted, so it is read as handled rather than guessed at.
        `void publish().then(...handlers);`,
        // A computed key this rule cannot resolve is a chain it does not report.
        `void publish()[method](onOk);`,
      ],
      invalid: [],
    });
  });
});
