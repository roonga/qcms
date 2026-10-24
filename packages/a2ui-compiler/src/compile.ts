import {
  resolveText,
  type FrozenSnapshot,
  type LocaleCode,
  type LocalizedText,
  type QuestionDefinition,
  type QuestionRef,
} from "@roonga/qcms-core";

import type { TextResolver } from "./mapping.js";
import {
  staticStepResolver,
  type StepResolver,
  type StepResolverContext,
} from "./step-resolver.js";
import type { A2UIDocument, CompiledForm } from "./types.js";
import { A2UI_SPEC_VERSION, COMPILER_VERSION } from "./version.js";

/**
 * The pure projection from meaning to view (ARCHITECTURE §3): one A2UI document
 * per step, version-stamped because the stored copy is served forever (ADR-18).
 * Depends on kernel types alone: never the database, never React, never a
 * runtime `@a2ra/core` import. It presumes a published snapshot, so an
 * unresolved pin or a missing default locale (I2, I3) throws (CONTRIBUTING).
 */

/** A question may be pinned at several versions, so identity alone is no key. */
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
        `compileForm: pin "${ref.questionId}"@${String(ref.version)} is not in the snapshot's questions - the snapshot is not self-contained (publish invariant I2)`,
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
        `compileForm: ${result.error.message} - the snapshot is missing the default locale (publish invariant I3)`,
      );
    }
    return result.value;
  };
}

/** The seam entry point: a resolver or test double is injected here. */
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

/** Compile a published snapshot through the launch static resolver. */
export function compileForm(
  snapshot: FrozenSnapshot,
  options: { locale?: LocaleCode },
): CompiledForm {
  return compileFormWith(staticStepResolver, snapshot, options);
}
