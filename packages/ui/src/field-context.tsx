import { createContext, useCallback, useContext } from "react";

import type { NativeFormAction } from "./native-submit.ts";

/**
 * The canonical answer encodings this renderer round-trips (DOMAIN_SCHEMA §2.4),
 * expressed structurally so `@roonga/qcms-ui` stays decoupled from
 * `@roonga/qcms-core` at runtime:
 *
 * | Question type        | Encoding                         | JS shape        |
 * |----------------------|----------------------------------|-----------------|
 * | shortText / longText | NFC string                       | `string`        |
 * | number               | finite IEEE double               | `number`        |
 * | date                 | ISO `YYYY-MM-DD`                 | `string`        |
 * | boolean              | JSON boolean                     | `boolean`       |
 * | singleChoice         | OptionId                         | `string`        |
 * | multiChoice          | OptionId[], deduplicated         | `readonly string[]` |
 *
 * Equivalence to the core `AnswerValue` schemas is asserted by the conformance
 * round-trip suite, not by a compile-time type dependency.
 */
export type A2UIAnswerValue = string | number | boolean | readonly string[];

/** Parent-owned answer map, keyed by questionId (the control's `name`). */
export type A2UIValues = Readonly<Record<string, A2UIAnswerValue | undefined>>;

/**
 * Parent-owned server-validation errors, keyed by questionId. Server errors are the
 * authority; the renderer surfaces them in each control's error slot with the ARIA
 * wiring react-aria supplies.
 */
export type A2UIErrors = Readonly<Record<string, string | undefined>>;

export interface QcmsFieldContextValue {
  readonly values: A2UIValues;
  readonly errors: A2UIErrors;
  /**
   * The form's own action when it is a function rather than a URL.
   *
   * It travels here rather than on the root `Form` node's props because a node's props
   * are the stored document's data, serialisable by construction, so a function cannot
   * ride there.
   */
  readonly formAction?: NativeFormAction;
  /**
   * Form-level hidden inputs the host needs in every post of this form, rendered as the
   * form's first children.
   *
   * A Server Action must be a stable module-level reference. Passing
   * `action.bind(null, id)` to `useActionState` hangs the server render: Next compares a
   * bound reference's signature asynchronously, that comparison never settles, and the
   * process accumulates promises until it dies. A hidden input carries the same value
   * with no bound reference.
   */
  readonly formHiddenFields?: Readonly<Record<string, string>>;
  /** Fires the canonical `AnswerValue` for `name` (or `undefined` when cleared). */
  readonly onChange: (name: string, value: A2UIAnswerValue | undefined) => void;
  /** Fires when focus leaves the control (touched semantics). */
  readonly onBlur: (name: string) => void;
  readonly locale: string;
  /**
   * Native (no-JS) submit mode. When true, the control adapters render uncontrolled
   * (a `defaultValue` seeded from `values`, no `onChange`) with a companion kind-tag
   * hidden input, so native form serialization carries the answer without JS.
   */
  readonly native: boolean;
}

/**
 * The controlled seam. `A2UIStepRenderer` is the only provider; the vendored controls
 * reach it through their qcms adapters keyed by the compiled `name` prop (= questionId).
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

/** Read/write one field's controlled state by its compiled `name` (questionId). */
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
 * The whole parent-owned answer map.
 *
 * A control should use {@link useQcmsField} instead. This exists for a presentation
 * whose content is a function of a column rather than of a field, such as the table
 * presentation's `<tfoot>` total: a hook per cell inside a loop whose length changes
 * between renders is a rules-of-hooks violation, so reading the map once is the only
 * correct shape. What it feeds is presentation only, never a write path.
 */
export function useQcmsValues(): A2UIValues {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.values;
}

/**
 * The render's BCP-47 locale, for a presentation that formats a number or picks a word
 * of its own. It is the same string react-aria formats against, so a column total
 * cannot be grouped differently from the cells above it.
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

/**
 * The form's action when the host supplied a function rather than a URL, or `undefined`
 * when the stored node's string `action` is what the form renders.
 */
export function useQcmsFormAction(): NativeFormAction | undefined {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.formAction;
}

/**
 * The form-level hidden inputs the host asked for, or `undefined` when it asked for
 * none, which is every step with no repeating group.
 */
export function useQcmsFormHiddenFields(): Readonly<Record<string, string>> | undefined {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.formHiddenFields;
}
