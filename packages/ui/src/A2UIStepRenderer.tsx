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
  /** Fires when focus leaves a control (touched semantics). */
  readonly onBlur?: (name: string) => void;
  /** BCP-47 locale for react-aria formatting/announcements. Text is already resolved at compile time. */
  readonly locale?: string;
  /** The document's `a2uiSpecVersion` - selects the render generation (ADR-18 seam). */
  readonly specVersion?: string;
  /**
   * Opt into native (no-JS) submit mode: a real `<form method="post" action=...>` with
   * uncontrolled, natively-serializing controls, so a JavaScript-disabled respondent
   * can POST the step. Render-time only; the stored document is never mutated (ADR-18).
   */
  readonly nativeSubmit?: NativeSubmitOptions;
  /**
   * Lower the document's own headings by this many levels, for a host that embeds the
   * document in a page that already has an `<h1>`. A compiled step carries its own
   * outline, so an untouched embed gives the page two `<h1>`s. `1` suits every current
   * embed; absent or `0` leaves the compiled levels alone, which is what the portal
   * wants. Render-time only, and only the `as` prop moves (ADR-18).
   */
  readonly headingLevelOffset?: number;
  /**
   * The repeating-group render (ADR-42, ADR-43).
   *
   * A compiled `RepeatGroup` is a template carrying its member controls once, because
   * the compiler is answer-blind and an instance count is answer-dependent, so the
   * expansion happens here from the live roster. `onAdd`, `onRemove` and `status` are
   * the scripted path and are absent without scripting. Absent, the group renders its
   * chrome and no instance, which is what an admin version view should show.
   */
  readonly repeat?: RepeatExpansion & QcmsRepeatContextValue;
}

const NO_VALUES: A2UIValues = Object.freeze({});
const NO_ERRORS: A2UIErrors = Object.freeze({});
const noop = (): void => {};

/**
 * The shared, controlled A2UI step renderer, and the only one, so admin preview
 * fidelity equals what the respondent gets (ARCHITECTURE §6).
 *
 * The parent owns `values` and `errors`. Constraint hints in the document are
 * advisory; the server errors the parent passes are authoritative, surfaced in each
 * control's error slot. The registry is always an explicit `createRegistry` of the
 * vendored components, never `defaultRegistry` (ADR-22).
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
  // Every control and the no-JS date fallback must read the same tag with the Gregorian
  // calendar and Latin digits forced: a date answer is an ISO day, so a locale whose
  // default calendar differs must not draw it as another date on one render only.
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
  // Render-time only (ADR-18): the stored `document.root` bytes are never mutated.
  // Order is load-bearing. The repeat expansion is the only transform that reads the
  // stored template, and the `Text` heading it emits for the group label must be in the
  // tree before demotion so an embedded preview renumbers it like any compiled heading;
  // demotion in turn must see only the compiled document's own headings.
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
      // On the no-JS path this becomes `autofocus` on that instance's heading, the ruled
      // landing after a roster operation; omitting it loses the focus move silently.
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
