import { createContext, useCallback, useContext } from "react";

/**
 * The canonical answer encodings this renderer round-trips (task 002,
 * DOMAIN_SCHEMA §2.4), expressed structurally so `@qcms/ui` stays decoupled
 * from `@qcms/core` at runtime:
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
 * The equivalence to `@qcms/core`'s `AnswerValue` schemas is asserted by the
 * conformance round-trip suite (which parses every emitted value with the core
 * parsers), not by a compile-time type dependency.
 */
export type A2UIAnswerValue = string | number | boolean | readonly string[];

/** Parent-owned answer map, keyed by questionId (the control's `name`). */
export type A2UIValues = Readonly<Record<string, A2UIAnswerValue | undefined>>;

/**
 * Parent-owned server-validation errors, keyed by questionId. Server errors are
 * the authority (SEC / task 009); the renderer surfaces them in each control's
 * error slot with the ARIA wiring react-aria supplies.
 */
export type A2UIErrors = Readonly<Record<string, string | undefined>>;

export interface QcmsFieldContextValue {
  readonly values: A2UIValues;
  readonly errors: A2UIErrors;
  /** Fires the canonical `AnswerValue` for `name` (or `undefined` when cleared). */
  readonly onChange: (name: string, value: A2UIAnswerValue | undefined) => void;
  /** Fires when focus leaves the control (touched semantics; policy is 029/030). */
  readonly onBlur: (name: string) => void;
  readonly locale: string;
  /**
   * Native (no-JS) submit mode (task 044). When true, the control adapters render
   * *uncontrolled* (a `defaultValue` seeded from `values`, no `onChange`) with a
   * companion kind-tag hidden input, so their native form serialization carries
   * the answer without JS. Default `false` keeps the controlled path (028/029)
   * exactly as-is - the conformance suite renders with this unset.
   */
  readonly native: boolean;
}

/**
 * The controlled seam. `A2UIStepRenderer` is the only provider; the vendored
 * controls reach it through their qcms adapters (`registry.tsx`) keyed by the
 * compiled `name` prop (= questionId). Kept out of the a2ra `FormStateContext`
 * (that channel is label-keyed and write-only) so values flow *down* and change
 * events carry canonical shapes.
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

/** Whether the renderer is in native (no-JS) submit mode (task 044). */
export function useQcmsNativeSubmit(): boolean {
  const ctx = useContext(QcmsFieldContext);
  if (ctx === null) {
    throw new Error("A2UI field components must be rendered inside <A2UIStepRenderer>.");
  }
  return ctx.native;
}
