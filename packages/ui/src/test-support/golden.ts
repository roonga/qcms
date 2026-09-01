import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { A2UIStepDocument } from "../A2UIStepRenderer.tsx";

/**
 * Loads the append-only golden corpus (task 012 `v1/`, task 026 `v2/`, issue #186
 * `v3/`) that is this renderer's conformance contract (ADR-18): every golden
 * document, every generation, must render correctly. The corpus is the single
 * source - the suite never hand-writes step documents (except a tiny Select fixture
 * for the one question type no golden exercises, see round-trip).
 *
 * Every generation is loaded, not only the newest, and that is the contract rather
 * than thoroughness: a snapshot published under an older compiler is served from its
 * stored bytes forever (R1, ADR-18), so a renderer that stopped handling `v1`'s
 * heading-without-typography or `v2`'s would break documents still in the field.
 * A new generation is added here in the same change that seeds it.
 */
export interface CompiledForm {
  readonly documents: readonly A2UIStepDocument[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
}

export interface GoldenStep {
  readonly version: string;
  readonly form: string;
  readonly stepId: string;
  readonly specVersion: string;
  readonly document: A2UIStepDocument;
}

// Resolve the golden corpus by walking up from the cwd (robust whether Vitest
// runs from the repo root or the package dir).
function findGoldenRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, "packages", "a2ui-compiler", "golden");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate packages/a2ui-compiler/golden from cwd");
}

const GOLDEN_ROOT = findGoldenRoot();
const VERSIONS = ["v1", "v2", "v3"] as const;

export function loadGoldenForms(): Array<{
  version: string;
  form: string;
  compiled: CompiledForm;
}> {
  const forms: Array<{ version: string; form: string; compiled: CompiledForm }> = [];
  for (const version of VERSIONS) {
    const dir = `${GOLDEN_ROOT}/${version}`;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".a2ui.json"))
      .sort();
    for (const file of files) {
      const compiled = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as CompiledForm;
      forms.push({ version, form: file.replace(".a2ui.json", ""), compiled });
    }
  }
  return forms;
}

/** Every step of every golden form, flattened for `it.each`. */
export function loadGoldenSteps(): GoldenStep[] {
  const steps: GoldenStep[] = [];
  for (const { version, form, compiled } of loadGoldenForms()) {
    for (const document of compiled.documents) {
      steps.push({
        version,
        form,
        stepId: document.stepId,
        specVersion: compiled.a2uiSpecVersion,
        document,
      });
    }
  }
  return steps;
}
