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
const VERSIONS = ["v1", "v2", "v3", "v4"] as const;

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

/**
 * A synthetic live roster for every `RepeatGroup` in one golden document, so a suite
 * driven by the corpus renders a group's member controls instead of an empty group
 * (task 073).
 *
 * A compiled `RepeatGroup` is a TEMPLATE: with no roster the renderer draws the
 * group's chrome and no instance, which is correct and renders none of the member
 * controls. Every corpus-derived suite that asserts something about "every control"
 * therefore needs instances, and the ids are made up here rather than read from
 * anywhere because a roster is session state that no compiled document carries.
 *
 * The ids look exactly like real ones (`ins_` + hex, `packages/core/src/ids.ts`), so a
 * qualified field name built from one is the same shape the portal produces.
 */
export function syntheticRoster(
  document: A2UIStepDocument,
  count = 1,
): Record<string, readonly string[]> {
  const rosters: Record<string, readonly string[]> = {};
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const props = record["props"];
    if (record["type"] === "RepeatGroup" && typeof props === "object" && props !== null) {
      const groupId = (props as Record<string, unknown>)["groupId"];
      if (typeof groupId === "string") {
        rosters[groupId] = Array.from(
          { length: count },
          (_unused, index) => `ins_${groupId.replaceAll(/[^a-z0-9]/gu, "")}${String(index + 1)}`,
        );
      }
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(document.root);
  return rosters;
}
