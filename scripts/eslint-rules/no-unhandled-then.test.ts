import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import { noUnhandledThen } from "./no-unhandled-then.mjs";

/**
 * `qcms/no-unhandled-then` (issue #809), driven through ESLint's own `RuleTester`.
 *
 * The invalid cases are not invented shapes. The first is the source that shipped as a
 * defect: `apps/admin/components/forms/form-actions.tsx` as it stood before PR #353,
 * which is one of the nine issue #352 counted, pasted rather than paraphrased. The two
 * after it are the sites this rule found on the day it landed.
 *
 * The valid cases matter as much, and the issue names them: the rule has to be silent on
 * the guarded `void Promise.resolve().then(...).catch(...)` idiom the admin's clipboard
 * components now carry, and on the two-argument `.then` in `step-editor.tsx`, or it
 * would flag the very fix it exists to ask for.
 *
 * `RuleTester` runs its cases as soon as `run` is called, so each call sits inside an
 * `it` rather than at module top level: a failure then names the case and not the file.
 * Vitest's globals are off in this repository, so `RuleTester` does not find a `describe`
 * to delegate to and executes the cases inline, which is exactly what is wanted here.
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

/** The pre-#353 body of `runPublish`, the shape all nine of issue #352's defects had. */
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
        // Issue #352's own shape, from the source that shipped it.
        { code: THE_352_SHAPE, errors: [{ messageId: "unhandledThen" }] },
        // `apps/admin/components/recovery-codes.tsx`, found by this rule.
        {
          code: `void copyRecoveryCodes(clipboard, codes).then((outcome) => { setNote(outcome); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        // `apps/api/src/schedulers/scheduler.ts`, found by this rule.
        {
          code: `void inFlight.then(() => { inFlight = undefined; scheduleNext(); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        // The bare statement form: no `void`, same defect.
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
        // Optional chaining is looked through rather than treated as an unknown node.
        {
          code: `void navigator.clipboard?.writeText(id).then(() => { announce(); });`,
          errors: [{ messageId: "unhandledThen" }],
        },
        // The computed spelling of the same call.
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
        // The fix issue #352 asked for, and PR #353 wrote.
        `void publish().then((state) => { setPublished(state); }).catch(() => { setPublished(failed); });`,
        // The guarded clipboard idiom `public-form-link.tsx`, `secure-links.tsx` and
        // `webhook-config.tsx` carry, which a rule that flagged it would be arguing against.
        `void Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(() => { announce(copied); }).catch(() => { announce(failed); });`,
        // Two-argument `.then`, which is how `step-editor.tsx` handles its refusal, and
        // which `@typescript-eslint/no-floating-promises` reports here anyway.
        `void navigator.clipboard?.writeText(id).then(() => { announce(copied); }, () => {});`,
        // A `.catch` last, with a `.finally` after it, is still handled.
        `void publish().then(onOk).catch(onFail).finally(() => { setBusy(false); });`,
        // Awaited: the rejection reaches the enclosing try, so it is not this defect.
        `async function f() { try { await publish().then(onOk); } catch { report(); } }`,
        // Returned: the caller owns the rejection.
        `function f() { return publish().then(onOk); }`,
        // Not a discard at all.
        `const settled = publish().then(onOk);`,
        // Fire-and-forget with no `.then`, the ten sites `ignoreVoid: false` would flag
        // and this rule deliberately says nothing about.
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
