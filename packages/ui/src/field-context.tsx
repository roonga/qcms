import { createContext, useCallback, useContext } from "react";

import type { NativeFormAction } from "./native-submit.ts";

/**
 * The canonical answer encodings (DOMAIN_SCHEMA §2.4), expressed structurally so this
 * package stays decoupled from the kernel at runtime: an NFC string for text, a finite
 * double for a number, an ISO `YYYY-MM-DD` for a date, a JSON boolean, an OptionId for
 * a single choice, and a deduplicated OptionId array for a multi choice. The
 * round-trip suite asserts the equivalence that no type dependency enforces.
 */
export type A2UIAnswerValue = string | number | boolean | readonly string[];

/** Keyed by questionId, which is the control's compiled `name`. */
export type A2UIValues = Readonly<Record<string, A2UIAnswerValue | undefined>>;

/** Keyed by questionId. Server errors are the authority. */
export type A2UIErrors = Readonly<Record<string, string | undefined>>;

export interface QcmsFieldContextValue {
  readonly values: A2UIValues;
  readonly errors: A2UIErrors;
  /**
   * Travels here rather than on the root `Form` node's props, because a node's props
   * are the stored document's serialisable data and a function cannot ride there.
   */
  readonly formAction?: NativeFormAction;
  /**
   * A Server Action must be a stable module-level reference: passing
   * `action.bind(null, id)` to `useActionState` hangs the server render, because the
   * bound reference's signature comparison never settles. A hidden input carries the
   * same value with no bound reference.
   */
  readonly formHiddenFields?: Readonly<Record<string, string>>;
  readonly onChange: (name: string, value: A2UIAnswerValue | undefined) => void;
  readonly onBlur: (name: string) => void;
  readonly locale: string;
  /** When true the adapters render uncontrolled, so the browser serializes the answer. */
  readonly native: boolean;
}

/**
 * Kept out of the a2ra `FormStateContext`, which is label-keyed and write-only, so
 * values flow down and change events carry canonical shapes.
 */
export const QcmsFieldContext = createContext<QcmsFieldContextValue | null>(null);

export interface QcmsField {
  readonly value: A2UIAnswerValue | undefined;
  readonly error: string | undefined;
  readonly setValue: (value: A2UIAnswerValue | undefined) => void;
  readonly blur: () => void;
}

/** One field's controlled state, by its compiled `name`. */
export function useQcmsField(name: string | undefined): QcmsField {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  const value = name === undefined ? undefined : ctx.values[name];
  const error = name === undefined ? undefined : ctx.errors[name];
  const { onChange, onBlur } = ctx;
  const setValue = useCallback(
    (next: A2UIAnswerValue | undefined) => {
      if (name !== undefined) onChange(name, next);
    },
    [onChange, name],
  );
  const blur = useCallback(() => {
    if (name !== undefined) onBlur(name);
  }, [onBlur, name]);
  return { value, error, setValue, blur };
}

/**
 * A control should use {@link useQcmsField}. This is for a presentation whose content
 * is a function of a column, such as a table total: a hook per cell inside a loop
 * whose length changes between renders is a rules-of-hooks violation.
 */
export function useQcmsValues(): A2UIValues {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.values;
}

/**
 * The same string react-aria formats against, so a computed total cannot be grouped
 * differently from the cells above it.
 */
export function useQcmsLocale(): string {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.locale;
}

/** Whether the renderer is in native (no-JS) submit mode. */
export function useQcmsNativeSubmit(): boolean {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.native;
}

/** `undefined` when the stored node's string `action` is what the form renders. */
export function useQcmsFormAction(): NativeFormAction | undefined {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.formAction;
}

/** `undefined` on every step with no repeating group. */
export function useQcmsFormHiddenFields(): Readonly<Record<string, string>> | undefined {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.formHiddenFields;
}
