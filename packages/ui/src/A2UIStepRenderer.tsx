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
import { withDemotedHeadings } from "./heading-demotion.ts";
import { isoDateLocale, withNativeSubmit, type NativeSubmitOptions } from "./native-submit.ts";
import { registryForSpecVersion } from "./registry.tsx";
import { QcmsRepeatContext, type QcmsRepeatContextValue } from "./repeat/repeat-context.tsx";
import { expandRepeatGroups, type RepeatExpansion } from "./repeat/repeat-expand.ts";

/** One compiled step: one entry of a compiled form's `documents`. */
export interface A2UIStepDocument {
  readonly stepId: string;
  readonly root: A2Node;
}

export interface A2UIStepRendererProps {
  readonly document: A2UIStepDocument;
  /** Parent-owned, keyed by questionId. */
  readonly values?: A2UIValues;
  /** Parent-owned server errors, keyed by questionId. */
  readonly errors?: A2UIErrors;
  /** `undefined` when the control was cleared. */
  readonly onChange?: (name: string, value: A2UIAnswerValue | undefined) => void;
  /** Touched semantics. */
  readonly onBlur?: (name: string) => void;
  /** BCP-47; compiled text is already resolved. */
  readonly locale?: string;
  /** The document's `a2uiSpecVersion`, which selects the render generation. */
  readonly specVersion?: string;
  /** Render-time only; the stored document is never mutated (ADR-18). */
  readonly nativeSubmit?: NativeSubmitOptions;
  /**
   * A compiled step carries its own `h1`, so a host embedding it under one of its own
   * passes `1` here. Render-time only, and only the `as` prop moves (ADR-18).
   */
  readonly headingLevelOffset?: number;
  /**
   * The compiler is answer-blind and an instance count is answer-dependent, so a
   * `RepeatGroup` template is expanded here from the live roster. Absent, the group
   * renders its chrome and no instance, which is what an admin version view shows.
   */
  readonly repeat?: RepeatExpansion & QcmsRepeatContextValue;
}

const NO_VALUES: A2UIValues = Object.freeze({});
const NO_ERRORS: A2UIErrors = Object.freeze({});
const noop = (): void => {};

/**
 * The only renderer, so admin preview fidelity equals what the respondent gets
 * (ARCHITECTURE §6). Constraint hints in the document are advisory and the server
 * errors the parent passes are authoritative. Never `defaultRegistry` (ADR-22).
 */
export function A2UIStepRenderer({
  document,
  values = NO_VALUES,
  errors = NO_ERRORS,
  onChange = noop,
  onBlur = noop,
  locale: requestedLocale = "en-US",
  specVersion,
  nativeSubmit,
  headingLevelOffset = 0,
  repeat,
}: A2UIStepRendererProps) {
  const registry = registryForSpecVersion(specVersion);
  // A date answer is an ISO day, so a locale whose default calendar differs must not
  // draw it as another date on one render only.
  const locale = useMemo(() => isoDateLocale(requestedLocale), [requestedLocale]);
  const native = nativeSubmit !== undefined;
  // The action travels in the context when it is a function: a node's props are stored,
  // serialisable data, so a Server Action cannot ride there.
  const formAction = nativeSubmit?.formAction;
  const formHiddenFields = nativeSubmit?.hiddenFields;
  const ctx = useMemo<QcmsFieldContextValue>(
    () => ({
      values,
      errors,
      onChange,
      onBlur,
      locale,
      native,
      ...(formAction !== undefined ? { formAction } : {}),
      ...(formHiddenFields !== undefined ? { formHiddenFields } : {}),
    }),
    [values, errors, onChange, onBlur, locale, native, formAction, formHiddenFields],
  );
  // Render-time only (ADR-18). Order is load-bearing: the group label the expansion
  // emits must be in the tree before demotion, and demotion must see only the compiled
  // document's own headings.
  const root = useMemo(() => {
    const expanded = expandRepeatGroups(document.root, repeat ?? {});
    const demoted = withDemotedHeadings(expanded, headingLevelOffset);
    return nativeSubmit === undefined ? demoted : withNativeSubmit(demoted, nativeSubmit);
  }, [document.root, headingLevelOffset, nativeSubmit, repeat]);
  const repeatCtx = useMemo<QcmsRepeatContextValue>(
    () => ({
      ...(repeat?.onAdd !== undefined ? { onAdd: repeat.onAdd } : {}),
      ...(repeat?.onRemove !== undefined ? { onRemove: repeat.onRemove } : {}),
      ...(repeat?.status !== undefined ? { status: repeat.status } : {}),
      ...(repeat?.busyGroupId !== undefined ? { busyGroupId: repeat.busyGroupId } : {}),
      // Omitting this loses the no-JS focus landing silently.
      ...(repeat?.autofocusId !== undefined ? { autofocusId: repeat.autofocusId } : {}),
    }),
    [repeat?.onAdd, repeat?.onRemove, repeat?.status, repeat?.busyGroupId, repeat?.autofocusId],
  );
  return (
    <I18nProvider locale={locale}>
      <QcmsFieldContext.Provider value={ctx}>
        <QcmsRepeatContext.Provider value={repeatCtx}>
          <A2Renderer node={root} registry={registry} />
        </QcmsRepeatContext.Provider>
      </QcmsFieldContext.Provider>
    </I18nProvider>
  );
}
