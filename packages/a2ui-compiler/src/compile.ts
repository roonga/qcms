import {
  resolveText,
  type FrozenSnapshot,
  type LocaleCode,
  type LocalizedText,
  type QuestionDefinition,
  type QuestionRef,
} from "@qcms/core";

import type { TextResolver } from "./mapping.js";
import {
  staticStepResolver,
  type StepResolver,
  type StepResolverContext,
} from "./step-resolver.js";
import type { A2UIDocument, CompiledForm } from "./types.js";
import { A2UI_SPEC_VERSION, COMPILER_VERSION } from "./version.js";

/**
 * `compileForm` — the pure projection from meaning to view (task 011,
 * ARCHITECTURE §3): a published {@link FrozenSnapshot} → one A2UI document per
 * step, stamped with the compiler and A2UI-spec versions (ADR-18, the stored
 * copy is served forever). Deterministic and side-effect free; depends on
 * `@qcms/core` types only — never `db`, never React, never a runtime
 * `@a2ra/core` import.
 *
 * Preconditions (a valid snapshot from `compileDraft`, task 008): every pinned
 * `QuestionRef` resolves within `snapshot.questions`, and every `LocalizedText`
 * carries the form's `defaultLocale` (publish invariants I2/I3). Violations are
 * caller bugs, not expected failures, so they throw rather than returning a
 * typed error (CONTRIBUTING: exceptions are for bugs only).
 */

/** Key a pin by identity + version (a question may be pinned at several versions). */
function pinKey(questionId: string, version: number): string {
  return `${questionId} ${String(version)}`;
}

function questionResolver(snapshot: FrozenSnapshot): (ref: QuestionRef) => QuestionDefinition {
  const byPin = new Map<string, QuestionDefinition>();
  for (const record of snapshot.questions) {
    byPin.set(pinKey(record.questionId, record.version), record.definition);
  }
  return (ref) => {
    const definition = byPin.get(pinKey(ref.questionId, ref.version));
    if (definition === undefined) {
      throw new Error(
        `compileForm: pin "${ref.questionId}"@${String(ref.version)} is not in the snapshot's questions — the snapshot is not self-contained (publish invariant I2)`,
      );
    }
    return definition;
  };
}

function textResolver(locale: LocaleCode, defaultLocale: LocaleCode): TextResolver {
  return (text: LocalizedText) => {
    const result = resolveText(text, locale, defaultLocale);
    if (!result.ok) {
      throw new Error(
        `compileForm: ${result.error.message} — the snapshot is missing the default locale (publish invariant I3)`,
      );
    }
    return result.value;
  };
}

/**
 * Compile a snapshot through an explicit {@link StepResolver} — the seam entry
 * point. `compileForm` is this with the {@link staticStepResolver}; a Phase-4
 * adaptive resolver (or a test double) is injected here (`docs/agent-seam.md`).
 */
export function compileFormWith(
  resolver: StepResolver,
  snapshot: FrozenSnapshot,
  options: { locale?: LocaleCode },
): CompiledForm {
  const { definition } = snapshot;
  const defaultLocale = definition.defaultLocale;
  const locale = options.locale ?? defaultLocale;
  const resolveQuestion = questionResolver(snapshot);
  const resolve = textResolver(locale, defaultLocale);

  const documents: A2UIDocument[] = definition.steps.map((step, index) => {
    const context: StepResolverContext = {
      snapshot,
      locale,
      resolveText: resolve,
      resolveQuestion,
      isFirstStep: index === 0,
    };
    return resolver.resolveStep(step, context);
  });

  return {
    documents,
    compilerVersion: COMPILER_VERSION,
    a2uiSpecVersion: A2UI_SPEC_VERSION,
  };
}

/**
 * Compile a published snapshot to its A2UI documents (one per step, keyed by
 * `stepId`) using the launch static resolver.
 */
export function compileForm(
  snapshot: FrozenSnapshot,
  options: { locale?: LocaleCode },
): CompiledForm {
  return compileFormWith(staticStepResolver, snapshot, options);
}
