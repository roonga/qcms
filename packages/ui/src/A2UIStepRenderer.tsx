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
import { withNativeSubmit, type NativeSubmitOptions } from "./native-submit.ts";
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
  /**
   * Opt into native (no-JS) submit mode (task 044): render a real
   * `<form method="post" action=...>` with uncontrolled, natively-serializing
   * controls and a real submit control, so a JavaScript-disabled respondent can
   * POST the step. Absent (the default) leaves the controlled path (028/029)
   * unchanged. This is a render-time capability only; the stored compiled
   * document is never mutated (ADR-18).
   */
  readonly nativeSubmit?: NativeSubmitOptions;
  /**
   * Lower the document's own headings by this many levels, for a host that EMBEDS the
   * document in a page that already has an `<h1>` (issue #537).
   *
   * A compiled step carries its own outline - the form title as `h1`, the step title as
   * `h2` - which is right when the document is the page, as it is on the portal. An admin
   * preview or version view is a document inside a page, and rendering it untouched gives
   * that page two `<h1>`s: a document-outline defect, and an ambiguous
   * `getByRole("heading", { level: 1 })` for anything testing the route.
   *
   * `1` is the answer for every current embed (the host page's `h1` is the page, the
   * document's headings start at `h2`). Absent or `0` leaves the document's own levels
   * alone, which is what the portal wants.
   *
   * Render-time only, and only the `as` prop moves: `size` and `weight` are left as
   * compiled so the embed still shows what a respondent sees. The stored document is
   * never mutated (ADR-18). See `heading-demotion.ts` for why this side of the contract
   * yields rather than the host chrome.
   */
  readonly headingLevelOffset?: number;
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
  nativeSubmit,
  headingLevelOffset = 0,
}: A2UIStepRendererProps) {
  const registry = registryForSpecVersion(specVersion);
  const native = nativeSubmit !== undefined;
  const ctx = useMemo<QcmsFieldContextValue>(
    () => ({ values, errors, onChange, onBlur, locale, native }),
    [values, errors, onChange, onBlur, locale, native],
  );
  // Render-time only (ADR-18): in native mode the root Form gains action/method and a
  // submit control, and an embedding host can lower the document's own heading levels.
  // The stored `document.root` bytes are never mutated by either.
  //
  // Demotion runs first, so it sees only the compiled document's own headings. The
  // submit control carries no heading and the order is therefore not load-bearing today,
  // but reversing it would make the appended node's future contents subject to a
  // transform that is meant to be about stored content alone.
  const root = useMemo(() => {
    const demoted = withDemotedHeadings(document.root, headingLevelOffset);
    return nativeSubmit === undefined ? demoted : withNativeSubmit(demoted, nativeSubmit);
  }, [document.root, headingLevelOffset, nativeSubmit]);
  return (
    <I18nProvider locale={locale}>
      <QcmsFieldContext.Provider value={ctx}>
        <A2Renderer node={root} registry={registry} />
      </QcmsFieldContext.Provider>
    </I18nProvider>
  );
}
