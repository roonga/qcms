// @ts-check
/**
 * `qcms/no-unhandled-then`: a discarded promise chain that ends in `.then(...)` with no
 * rejection handler (issue #809, split from #352).
 *
 * ## The shape
 *
 * All nine handlers issue #352 counted shipped as the same three lines:
 *
 * ```tsx
 * void publish().then((state) => {
 *   setPublished(state);
 *   setDialog(null);
 * });
 * ```
 *
 * The resolved path is written, the rejected one is not written at all, and a server
 * action that rejects instead of returning a failure state therefore sets no state,
 * renders no alert, and leaves the dialog sitting there looking like a slow network.
 * PR #353 added the `.catch` to five of them and PR #380 to the rest; PR #807 covered
 * every handler that now exists with a rendered test and asserted the enumeration, so a
 * tenth `.catch` cannot arrive without its test. What none of that reaches is the
 * TENTH site written the way the first nine were, with no `.catch` to enumerate:
 * `apps/admin/components/rejection-coverage.test.ts` says so in its own prose. This rule
 * is that half, and it runs at write time rather than at review time.
 *
 * ## Why not a rule that already exists
 *
 * **`@typescript-eslint/no-floating-promises` cannot see this shape**, because `void` is
 * that rule's sanctioned way of saying "deliberately not awaited": with the default
 * `ignoreVoid: true` every one of the nine defects was a green.
 *
 * `ignoreVoid: false` sees them, and sees far too much else. Measured on the tree this
 * rule landed in, it reports **13** sites, of which **2** are this shape. Ten are
 * `void someAsyncCall()` with no `.then` at all - the intentional fire-and-forget the
 * codebase uses on purpose (`void send()`, `void boot()`, `void finishShutdown(signal)`,
 * the autosave timer, a Playwright `void page.route(...)`) - and one is a FALSE
 * positive: `void navigator.clipboard?.writeText(id).then(onOk, onFail)` in
 * `apps/admin/components/forms/step-editor.tsx` carries its rejection handler as the
 * second argument, and the rule reports it anyway because the optional chain wraps the
 * call. So turning that option on would buy two true reports for eleven suppressions,
 * and eleven inline disables are how a rule stops being read.
 *
 * `eslint-plugin-promise`'s `catch-or-return` is closer, and was not taken for two
 * reasons. It is a dependency for something the sixty lines below do, which
 * `CONTRIBUTING.md` calls a liability rather than a convenience. And its documented
 * default `allowThen: false` reports the two-argument `.then` that the step-editor site
 * uses correctly, so it would need configuration to stop making the same false report
 * (`eslint-community/eslint-plugin-promise`, `docs/rules/catch-or-return.md`, read
 * 2026-09-11).
 *
 * No `eslint-plugin-sonarjs` rule covers it: the 279 rules it ships include
 * `void-use`, `no-try-promise` and `prefer-promise-shorthand`, and none of them look at
 * whether a discarded chain handles a rejection.
 *
 * ## What it flags, and what it deliberately does not
 *
 * It flags an **expression statement** whose chain ends in `.then(...)` with fewer than
 * two arguments, with or without a leading `void`, looking through `?.`, `as`, `!` and
 * any trailing `.finally(...)` (a `finally` handler does not handle a rejection; it
 * re-raises it). A chain ending in `.catch(...)`, or in `.then(onFulfilled, onRejected)`,
 * is handled and is not reported. So the guarded `void Promise.resolve().then(...).catch(...)`
 * idiom the admin's clipboard components carry is silent here, which is the point: the
 * idiom is the fix, and a rule that flagged it would be teaching the wrong lesson.
 *
 * Three things are out of scope on purpose.
 *
 * - **`await p.then(cb)`**, and `return p.then(cb)`. Both hand the rejection somewhere
 *   that can still see it - the enclosing `try`, or the caller - so neither is this
 *   defect. Only a statement that discards the chain is.
 * - **An expression-bodied arrow that returns a chain**, `onPress={() => p.then(cb)}`.
 *   The discard is real there, but it is a discard the CALLER makes, and a rule that
 *   cannot tell that arrow from `const f = () => p.then(cb)` would report every promise
 *   helper in the tree. `no-misused-promises` is the rule that owns that shape.
 * - **`p.then(onOk, undefined)`**, which is unhandled and is counted here as handled.
 *   Two arguments is the signal; nobody writes that second one on purpose.
 *
 * It is a syntax-only rule - no type information - so it costs nothing to run and
 * applies to the `.mjs` tooling files as well as to app source. The price of that is
 * the one false positive it can produce: `something.then(cb)` on an object that is not
 * a promise and merely has a `then` method. Nothing in this repository is that, and the
 * inline disable is one line if something ever is.
 */

/**
 * Unwrap the type-only and chain wrappers that sit between a statement and the call it
 * actually makes, so `(await x)!.then(...)` and `a?.b().then(...)` are read as the calls
 * they are rather than skipped as an unfamiliar node type.
 *
 * @param {any} node
 * @returns {any}
 */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === "ChainExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSInstantiationExpression")
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The name of the member being called, for both `p.then(...)` and `p["then"](...)`.
 *
 * @param {any} member a MemberExpression node
 * @returns {string | undefined} the name, or undefined for a computed key that is not a
 *   string literal (`p[key](...)`, which this rule cannot and does not reason about)
 */
function memberName(member) {
  if (member.computed) {
    return member.property.type === "Literal" && typeof member.property.value === "string"
      ? member.property.value
      : undefined;
  }
  return member.property.type === "Identifier" ? member.property.name : undefined;
}

/**
 * The `.then(...)` call a chain ends in when that chain handles no rejection.
 *
 * Walks from the outermost call inwards, past `.finally(...)` only. Reaching a `.catch`
 * or a two-argument `.then` means the chain is handled and the walk stops with nothing;
 * so does reaching any other call, because a chain this rule does not recognise is a
 * chain it has no business reporting.
 *
 * @param {any} node the statement's expression, `void` already stripped
 * @returns {any} the offending CallExpression, or undefined
 */
function unhandledTerminalThen(node) {
  let current = unwrap(node);
  while (current && current.type === "CallExpression") {
    const callee = unwrap(current.callee);
    if (callee.type !== "MemberExpression") return undefined;
    const name = memberName(callee);
    if (name === "catch") return undefined;
    if (name === "then") {
      // A spread cannot be counted, so it is read as handled rather than guessed at.
      if (current.arguments.some((/** @type {any} */ arg) => arg.type === "SpreadElement")) {
        return undefined;
      }
      return current.arguments.length >= 2 ? undefined : current;
    }
    if (name !== "finally") return undefined;
    current = unwrap(callee.object);
  }
  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noUnhandledThen = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a discarded promise chain that ends in .then(...) to handle its rejection",
      url: "https://github.com/roonga/qcms/issues/809",
    },
    schema: [],
    messages: {
      unhandledThen:
        "This chain is discarded and ends in `.then(...)` with no rejection handler, so a rejection here is silent (issue #352). End it with `.catch(...)`, pass `.then(onFulfilled, onRejected)`, or `await` it.",
    },
  },
  create(context) {
    return {
      /** @param {any} statement */
      ExpressionStatement(statement) {
        const expression =
          statement.expression.type === "UnaryExpression" &&
          statement.expression.operator === "void"
            ? statement.expression.argument
            : statement.expression;
        const offender = unhandledTerminalThen(expression);
        if (offender === undefined) return;
        context.report({
          node: unwrap(offender.callee).property,
          messageId: "unhandledThen",
        });
      },
    };
  },
};
