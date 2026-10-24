import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { A2UIStepDocument } from "../A2UIStepRenderer.tsx";

/**
 * Loads the append-only golden corpus that is this renderer's conformance contract
 * (ADR-18). Every generation is loaded, not only the newest, and that is the contract
 * rather than thoroughness: a snapshot published under an older compiler is served
 * from its stored bytes forever (R1), so a renderer that stopped handling an older
 * generation would break documents still in the field. A new generation is added here
 * in the same change that seeds it.
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

// Walks up from the cwd, because Vitest may run from the repo root or the package dir.
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
 * A synthetic live roster for every `RepeatGroup` in one golden document, so a
 * corpus-driven suite renders a group's member controls instead of an empty group.
 *
 * A compiled `RepeatGroup` is a template, so with no roster the renderer correctly
 * draws the group's chrome and no instance. The ids are made up here because a roster
 * is session state no compiled document carries, and they take the real `ins_` shape
 * so a qualified field name built from one matches what the portal produces.
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
