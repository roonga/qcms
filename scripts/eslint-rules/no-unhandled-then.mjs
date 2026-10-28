// @ts-check
/**
 * `@typescript-eslint/no-floating-promises` cannot see this shape: `void` is that rule's
 * sanctioned way of saying "deliberately not awaited", and `ignoreVoid: false` reports
 * the intentional fire-and-forget calls this codebase uses on purpose.
 *
 * Out of scope on purpose: `await p.then(cb)` and `return p.then(cb)`, which hand the
 * rejection somewhere that can still see it; an expression-bodied arrow returning a
 * chain, where the discard is the caller's (`no-misused-promises` owns that); and
 * `p.then(onOk, undefined)`, since two arguments is the only signal available.
 *
 * Syntax-only, so it can falsely report a non-promise object that has a `then` method.
 */

/**
 * `await` is deliberately absent: an awaited chain is not this defect, and its
 * expression is an `AwaitExpression`, so it never reaches here anyway.
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
 * `undefined` for a computed key that is not a string literal, which is out of reach.
 *
 * @param {any} member
 * @returns {string | undefined}
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
 * Walks outermost inwards past `.finally(...)` only. Any other unrecognised call stops
 * the walk with nothing, since this rule has no business reporting a chain it cannot
 * read. A `finally` handler does not handle a rejection; it re-raises it.
 *
 * @param {any} node
 * @returns {any}
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
