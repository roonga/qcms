import { A2Renderer } from "@a2ra/core";
import type { A2Node } from "@a2ra/core";
import { useMemo } from "react";
import { I18nProvider } from "react-aria-components";

import type {
  A2UIAnswerValue,
  A2UIErrors,
  A2UIValues,
  QcmsFieldContextValue,
} from "./field-context.tsx";
import { QcmsFieldContext } from "./field-context.tsx";
import { registryForSpecVersion } from "./registry.tsx";

/** One compiled A2UI step document (one entry of a compiled form's `documents`). */
export interface A2UIStepDocument {
  readonly stepId: string;
  readonly root: A2Node;
}

export interface A2UIStepRendererProps {
  /** The compiled step document to render (its `root` node tree). */
  readonly document: A2UIStepDocument;
  /** Parent-owned canonical answers, keyed by questionId. */
  readonly values?: A2UIValues;
  /** Parent-owned server-validation errors, keyed by questionId (the authority). */
  readonly errors?: A2UIErrors;
  /** Fires the canonical `AnswerValue` for a control (or `undefined` when cleared). */
  readonly onChange?: (name: string, value: A2UIAnswerValue | undefined) => void;
  /** Fires when focus leaves a control (touched semantics; policy is 029/030). */
  readonly onBlur?: (name: string) => void;
  /** BCP-47 locale for react-aria formatting/announcements. Text is already resolved at compile time. */
  readonly locale?: string;
  /** The document's `a2uiSpecVersion` - selects the render generation (ADR-18 seam). */
  readonly specVersion?: string;
}

const NO_VALUES: A2UIValues = Object.freeze({});
const NO_ERRORS: A2UIErrors = Object.freeze({});
const noop = (): void => {};

/**
 * The shared, controlled A2UI step renderer (task 028) - the *only* renderer,
 * so admin preview fidelity equals what the respondent gets (ARCHITECTURE §6).
 *
 * Controlled: the parent owns `values` and `errors`; this component owns no
 * fetch and no state beyond the vendored controls' ephemeral input. It composes
 * a2ra's `A2Renderer` over an explicit `createRegistry` of the vendored
 * components (never `defaultRegistry`, ADR-22). Client-side constraint hints in
 * the document are advisory; the authoritative errors are the server ones the
 * parent passes, surfaced in each control's error slot with the ARIA wiring
 * react-aria supplies.
 */
export function A2UIStepRenderer({
  document,
  values = NO_VALUES,
  errors = NO_ERRORS,
  onChange = noop,
  onBlur = noop,
  locale = "en-US",
  specVersion,
}: A2UIStepRendererProps) {
  const registry = registryForSpecVersion(specVersion);
  const ctx = useMemo<QcmsFieldContextValue>(
    () => ({ values, errors, onChange, onBlur, locale }),
    [values, errors, onChange, onBlur, locale],
  );
  return (
    <I18nProvider locale={locale}>
      <QcmsFieldContext.Provider value={ctx}>
        <A2Renderer node={document.root} registry={registry} />
      </QcmsFieldContext.Provider>
    </I18nProvider>
  );
}
