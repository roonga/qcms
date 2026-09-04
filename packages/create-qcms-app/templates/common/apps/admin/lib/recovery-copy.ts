/**
 * What "Copy codes" on the one-time recovery-code screen actually does, as a pure
 * function over the clipboard it is handed (issue 683).
 *
 * ## Why the decision is a module and not three lines inside the component
 *
 * The interesting behaviour here is not the markup, it is **which of three things
 * happened**. Written as a function over an injected clipboard, every one of them is
 * stateable directly and needs no DOM at all; what is left in the component is the markup
 * and the `useState` call, and `e2e/recovery-copy.pw.ts` is the browser walk that proves
 * the two are wired together (ADR-23: e2e at the highest layer that exists for it).
 *
 * This was originally written because the admin had no jsdom layer, so a `useState`
 * transition was not observable below the browser at all. It has one now
 * (`vitest.dom.config.ts`, issue #352) and the shape still stands on its own: a decision
 * expressed as a function over its inputs can be read, named and tested in the decision's
 * own terms, where a render test can only assert what it looks like from outside. That is
 * why `docs/COMPONENT_GUIDELINES.md` names this file as the exemplar and asks the choice
 * to be made at design time (issue #697). `lib/forms/picker-selection.ts` is the same
 * shape for a different screen.
 *
 * ## The failure path is the point, and it is why this does not use the `?.` idiom
 *
 * `components/forms/step-editor.tsx` copies a question id with
 * `navigator.clipboard?.writeText(id).then(...)`, where the `?.` short-circuits the whole
 * chain, so an absent clipboard is a silent no-op. That is deliberate and correct there: the
 * id is rendered in full in the cell beside the button and on the question's own route, so
 * nothing is lost and an error state would be noise.
 *
 * **It is the wrong shape here.** A recovery code is shown once and nothing reads it back
 * (#319 removed the route that did), so an operator who believes they copied ten codes and
 * did not has lost the credential of last resort - and a silent no-op is precisely the
 * experience that produces that belief. So the absence of the API is a case this handles and
 * reports, not one it short-circuits past.
 *
 * `try`/`catch` around the write rather than `.then(ok, fail)`, for the same reason: a
 * rejected promise is not the only way a clipboard write fails. An engine that throws
 * synchronously from `writeText` would sail straight past a rejection handler.
 *
 * ## What the operator sees
 *
 * Two outcomes, not three. An absent `navigator.clipboard` (an insecure context, or an older
 * engine) and a refused or failed write are different causes with the same remedy: select the
 * ten codes that are still on screen and copy them by hand. The status line says that, in the
 * wording both POCs draw. Naming the cause would trade a sentence the operator can act on for
 * one they cannot.
 *
 * Nothing here logs, and nothing here may. SEC-13's allowlist exists for exactly this class
 * of value: the codes go from the props to the clipboard and nowhere else.
 */

/**
 * The text a copy puts on the clipboard: one code per line, in the order shown.
 *
 * Newline-separated because that is what a password manager's bulk-paste and every text
 * editor expect, and because it is what the operator sees: the list is one code per row.
 */
export function recoveryCodesText(codes: readonly string[]): string {
  return codes.join("\n");
}

/** Which sentence the status line carries after a press. */
export type CopyOutcome = "copied" | "failed";

/**
 * Attempt the copy and say what happened.
 *
 * Takes the clipboard rather than reaching for `navigator`, so the absent case is a value a
 * test can pass rather than a global it has to dismantle. **This never rejects**: every path
 * resolves to an outcome, because the one thing the caller must not do is leave the status
 * line empty after a press.
 */
export async function copyRecoveryCodes(
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  codes: readonly string[],
): Promise<CopyOutcome> {
  if (clipboard === undefined) return "failed";
  try {
    await clipboard.writeText(recoveryCodesText(codes));
    return "copied";
  } catch {
    return "failed";
  }
}
