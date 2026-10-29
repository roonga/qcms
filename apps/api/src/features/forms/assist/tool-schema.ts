/**
 * Zod's `definitions` block for recursive `Condition` nodes is ignored by LM Studio (it
 * reads `$defs`) and refused as a cycle by the AI SDK's Google provider. Rewriting to an
 * acyclic document is safe: every executor re-parses with the full Zod schema.
 */

// Taken from `ai` rather than `@types/json-schema` so the tool surface is typed by the
// same declaration the SDK hands a provider; `ai` does not re-export the sibling alias.
import type { JSONSchema7 } from "ai";

type JSONSchema7Definition = JSONSchema7 | boolean;

/** Deliberately not the kernel's `CONDITION_MAX_DEPTH`: this only bounds the advertisement. */
export const TOOL_SCHEMA_CONDITION_DEPTH = 3;

/** An absent value means unsatisfiable, not omitted: no instance matches the branch. */
interface Expansion<T> {
  readonly value: T | undefined;
}

const UNSATISFIABLE: Expansion<never> = { value: undefined };

function written<T>(value: T): Expansion<T> {
  return { value };
}

const SUBSCHEMA_KEYS = ["items", "additionalProperties", "not", "contains"] as const;

const SUBSCHEMA_MAP_KEYS = ["properties", "patternProperties", "definitions", "$defs"] as const;

const BRANCH_KEYS = ["oneOf", "anyOf", "allOf"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only `#/`-rooted pointers resolve; a pointer outside this document is the defect to drop. */
function resolvePointer(root: JSONSchema7, ref: string): JSONSchema7Definition | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current as JSONSchema7Definition | undefined;
}

function definitionName(ref: string, budget: number): string {
  const tail = ref.slice(ref.lastIndexOf("/") + 1).replaceAll(/\W/gu, "_");
  return `${tail}_d${String(budget)}`;
}

interface Rewriter {
  readonly root: JSONSchema7;
  readonly defs: Map<string, Expansion<JSONSchema7Definition>>;
}

/**
 * The budget strictly decreases through every reference, so an entry at budget n names
 * only entries at n-1: the walk terminates on a cyclic document and needs no cycle check.
 */
function expandRef(
  node: JSONSchema7,
  ref: string,
  budget: number,
  rewriter: Rewriter,
): Expansion<JSONSchema7Definition> {
  if (budget <= 0) return UNSATISFIABLE;
  const name = definitionName(ref, budget);

  if (!rewriter.defs.has(name)) {
    const target = resolvePointer(rewriter.root, ref);
    rewriter.defs.set(
      name,
      target === undefined ? UNSATISFIABLE : expand(target, budget - 1, rewriter),
    );
  }
  if (rewriter.defs.get(name)?.value === undefined) return UNSATISFIABLE;

  const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"));
  return written({ ...siblings, $ref: `#/$defs/${name}` });
}

function expandMap(
  value: Record<string, unknown>,
  budget: number,
  rewriter: Rewriter,
): Record<string, JSONSchema7Definition> {
  const mapped: Record<string, JSONSchema7Definition> = {};
  for (const [name, sub] of Object.entries(value)) {
    const { value: expanded } = expand(sub as JSONSchema7Definition, budget, rewriter);
    if (expanded !== undefined) mapped[name] = expanded;
  }
  return mapped;
}

/** `allOf` is all-or-nothing because dropping a conjunct would widen the schema. */
function expandBranch(
  key: string,
  value: unknown[],
  budget: number,
  rewriter: Rewriter,
): Expansion<JSONSchema7Definition[]> {
  const arms = value
    .map((arm) => expand(arm as JSONSchema7Definition, budget, rewriter).value)
    .filter((arm): arm is JSONSchema7Definition => arm !== undefined);
  if (arms.length === 0) return UNSATISFIABLE;
  if (key === "allOf" && arms.length !== value.length) return UNSATISFIABLE;
  return written(arms);
}

/** Positions where an unwritable subschema makes the container unwritable too. */
function expandKeyword(
  key: string,
  value: unknown,
  budget: number,
  rewriter: Rewriter,
): Expansion<unknown> {
  if ((SUBSCHEMA_MAP_KEYS as readonly string[]).includes(key) && isRecord(value)) {
    return written(expandMap(value, budget, rewriter));
  }
  if ((BRANCH_KEYS as readonly string[]).includes(key) && Array.isArray(value)) {
    return expandBranch(key, value, budget, rewriter);
  }
  if (!(SUBSCHEMA_KEYS as readonly string[]).includes(key)) return written(value);
  if (Array.isArray(value)) {
    const items = value.map(
      (item) => expand(item as JSONSchema7Definition, budget, rewriter).value,
    );
    return items.includes(undefined) ? UNSATISFIABLE : written(items);
  }
  return expand(value as JSONSchema7Definition, budget, rewriter);
}

function requiredNamesSurvive(node: Record<string, unknown>): boolean {
  if (!Array.isArray(node.required) || !isRecord(node.properties)) return true;
  const properties = node.properties;
  return node.required.every((name) => typeof name !== "string" || name in properties);
}

function expand(
  node: JSONSchema7Definition,
  budget: number,
  rewriter: Rewriter,
): Expansion<JSONSchema7Definition> {
  // A literal `false` is the author's own "nothing matches", not the unsatisfiable sentinel.
  if (typeof node === "boolean") return written(node);
  if (typeof node.$ref === "string") return expandRef(node, node.$ref, budget, rewriter);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // The original definition blocks are raw material, not output.
    if (key === "definitions" || key === "$defs") continue;
    const expanded = expandKeyword(key, value, budget, rewriter);
    if (expanded.value === undefined) return UNSATISFIABLE;
    out[key] = expanded.value;
  }

  // A dropped required property leaves an object no instance can satisfy.
  return requiredNamesSurvive(out) ? written(out as JSONSchema7Definition) : UNSATISFIABLE;
}

/**
 * Throws when the root is unsatisfiable at this depth: that is a composition-time
 * programming error, and failing here beats shipping a tool no model can call.
 */
export function selfContainedToolSchema(
  schema: JSONSchema7,
  budget: number = TOOL_SCHEMA_CONDITION_DEPTH,
): JSONSchema7 {
  const rewriter: Rewriter = { root: schema, defs: new Map() };
  const rewritten = expand(schema, budget, rewriter).value;
  if (rewritten === undefined || typeof rewritten === "boolean") {
    throw new Error("Tool schema is unsatisfiable at the configured reference depth");
  }

  const defs: Record<string, JSONSchema7Definition> = {};
  for (const [name, entry] of rewriter.defs) {
    if (entry.value !== undefined) defs[name] = entry.value;
  }
  if (Object.keys(defs).length === 0) return rewritten;
  return { ...rewritten, $defs: defs };
}

/** Exported only for the tests: the fake provider never reads a tool schema. */
export function collectRefs(schema: JSONSchema7): { ref: string; resolves: boolean }[] {
  const found: { ref: string; resolves: boolean }[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (!isRecord(node) && !Array.isArray(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node.$ref === "string") {
      found.push({ ref: node.$ref, resolves: resolvePointer(schema, node.$ref) !== undefined });
    }
    for (const value of Object.values(node)) walk(value);
  };

  walk(schema);
  return found;
}
