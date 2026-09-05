/**
 * Making the emitted tool schemas self-contained (issue #820).
 *
 * The slice writes its tool inputs in Zod, the same schema language the domain
 * and the OpenAPI documents use, and that is the right call: one language end to
 * end, and the kernel's own `FormDefinition` is what a proposal is checked
 * against. But `FormDefinition.rules[].when` is a `Condition`, and `Condition`
 * is recursive (`packages/core/src/visibility-rule.ts` - `and`, `or` and `not`
 * nest). A Zod-to-JSON-Schema conversion cannot write a recursive type inline,
 * so it hoists the node into a `definitions` block and leaves a `$ref` behind.
 *
 * That is legal JSON Schema and useless as a tool schema, for two independent
 * reasons measured against real engines on 2026-09-05:
 *
 *  1. **`definitions` is draft-07 spelling.** LM Studio's schema-to-grammar
 *     conversion reads `$defs` and does not read `definitions`, so the block is
 *     dropped as an unknown keyword and the surviving `$ref` resolves to
 *     nothing. The whole tool set is rejected with HTTP 400 before any
 *     inference happens, which is what made `propose_draft` - the tool that
 *     produces the proposal - non-functional on that provider.
 *  2. **Recursion is not portable even when the block is found.** The AI SDK's
 *     Google provider resolves a `$ref` by inlining it and refuses a cycle
 *     outright (`convertJSONSchemaReference` throws
 *     `UnsupportedFunctionalityError` for a recursive reference); with our
 *     schema it cannot use its native `parameters` conversion at all and falls
 *     back to handing Gemini the raw document. Renaming the keyword fixes
 *     engine 1 and leaves engine 2 exactly where it was.
 *
 * So the fix is not a rename. {@link selfContainedToolSchema} rewrites a
 * converted schema into one that is **self-contained and acyclic**: every `$ref`
 * points at a `$defs` entry in the same document, and the entries are numbered
 * by remaining depth so no entry can reach itself. Recursion is unrolled to a
 * fixed budget and the arms that would have needed one more level are dropped.
 *
 * ## Why dropping arms is sound
 *
 * The tool schema is an **advertisement**, never the authority. Every tool
 * executor re-parses its input with the full Zod schema
 * (`ProposeDraftInput.parse` in `tools.ts`), which is `FormDefinition` with the
 * kernel's real `CONDITION_MAX_DEPTH` of 8, and a proposal is validated a second
 * time by `ctx.validate` before it can reach the UI. A bounded advertisement can
 * therefore only ever describe *less* than the kernel accepts, never more:
 *
 *  - it cannot admit an invalid form, because narrowing a schema removes
 *    documents from the accepted set and adds none, and the Zod parse runs on
 *    whatever arrives regardless of what was advertised;
 *  - it does not narrow what the kernel accepts either, because a model that
 *    emits a deeper condition anyway (only a grammar-constrained engine is
 *    actually held to the advertised shape) is parsed by the full schema and
 *    accepted on its merits.
 *
 * `tool-schema.test.ts` pins both directions of that property rather than
 * leaving it as prose.
 *
 * ## Why this depth
 *
 * {@link TOOL_SCHEMA_CONDITION_DEPTH} is 3, measured rather than guessed. Across
 * every `rules[].when` in the golden corpora and the repository's fixtures the
 * distribution is 49 conditions at depth 1, three at depth 2, one at depth 3,
 * and one at depth 8 - and that last one is `golden/evaluator/forms/depth-8.json`,
 * the fixture that exists to sit on the `CONDITION_MAX_DEPTH` boundary rather
 * than an authored form. Depth 3 covers every real condition in the repository
 * with the cheapest document that does so.
 */

// `ai` re-exports the provider's `JSONSchema7`, which is the exact type the SDK
// hands to a provider as a tool's parameters. Taking it from there rather than
// adding `@types/json-schema` keeps the tool surface typed by the same
// declaration the SDK uses; the sibling `Definition` alias is spelled locally
// because `ai` does not re-export it.
import type { JSONSchema7 } from "ai";

/** A subschema position: a schema, or the boolean shorthand JSON Schema allows. */
type JSONSchema7Definition = JSONSchema7 | boolean;

/**
 * How many times a recursive reference is unrolled for the tool surface.
 *
 * Not the kernel's limit and deliberately not tied to it: `CONDITION_MAX_DEPTH`
 * is what a form may contain, this is what the tool schema bothers to describe.
 * Raising it costs bytes in every upstream request; lowering it costs nothing
 * but expressiveness in the advertisement. See the module comment for the
 * measurement behind the value.
 */
export const TOOL_SCHEMA_CONDITION_DEPTH = 3;

/**
 * What expanding one node or one keyword produced, or nothing.
 *
 * "Unsatisfiable" rather than "omitted" because that is what an absent value
 * means here: no instance matches the branch. The honest edits then differ by
 * position - drop it where the schema stays coherent without it (one arm of a
 * union, one optional property), propagate it where it does not (an array's
 * element type, a required property) - and every caller below picks one.
 */
interface Expansion<T> {
  readonly value: T | undefined;
}

const UNSATISFIABLE: Expansion<never> = { value: undefined };

function written<T>(value: T): Expansion<T> {
  return { value };
}

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYS = ["items", "additionalProperties", "not", "contains"] as const;

/** Keywords whose value is a map of name to subschema. */
const SUBSCHEMA_MAP_KEYS = ["properties", "patternProperties", "definitions", "$defs"] as const;

/** Keywords whose value is a list of subschemas. */
const BRANCH_KEYS = ["oneOf", "anyOf", "allOf"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve a local JSON pointer against the root document.
 *
 * Only `#/`-rooted pointers are understood, which is every pointer a
 * Zod-to-JSON-Schema conversion emits. Anything else is treated as unresolvable
 * and its branch is dropped, because a tool schema that reaches outside its own
 * document is exactly the defect this module exists to remove.
 */
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

/** A stable, readable `$defs` name for one reference unrolled at one budget. */
function definitionName(ref: string, budget: number): string {
  const tail = ref.slice(ref.lastIndexOf("/") + 1).replaceAll(/\W/gu, "_");
  return `${tail}_d${String(budget)}`;
}

interface Rewriter {
  readonly root: JSONSchema7;
  /** Every `$defs` entry decided so far, by name. */
  readonly defs: Map<string, Expansion<JSONSchema7Definition>>;
}

/**
 * Expand a `$ref` into a `$defs` entry numbered by the remaining budget.
 *
 * The budget strictly decreases through every reference, so an entry written at
 * budget *n* only ever names entries at budget *n-1*: the walk terminates on a
 * cyclic document, and the emitted graph is acyclic by construction rather than
 * by a cycle check that could be got wrong.
 */
function expandRef(
  node: JSONSchema7,
  ref: string,
  budget: number,
  rewriter: Rewriter,
): Expansion<JSONSchema7Definition> {
  if (budget <= 0) return UNSATISFIABLE;
  const name = definitionName(ref, budget);

  // No re-entry guard is needed and none is written: computing an entry at
  // budget n only ever asks for entries at budget n-1, and budget 0 terminates.
  // A guard here would be a second, weaker statement of that same fact.
  if (!rewriter.defs.has(name)) {
    const target = resolvePointer(rewriter.root, ref);
    rewriter.defs.set(
      name,
      target === undefined ? UNSATISFIABLE : expand(target, budget - 1, rewriter),
    );
  }
  if (rewriter.defs.get(name)?.value === undefined) return UNSATISFIABLE;

  // Keywords sitting beside the `$ref` (a `description`, typically) are kept.
  const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"));
  return written({ ...siblings, $ref: `#/$defs/${name}` });
}

/** A map of named subschemas. An entry that cannot be written is not offered. */
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

/**
 * A branch list. A union that lost every arm describes nothing; `allOf` is
 * stricter still, since dropping a conjunct would *widen* the schema.
 */
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

/**
 * One keyword's value. `UNSATISFIABLE` here poisons the whole node: these are
 * the positions (an array's element type, a tuple member, an open-properties
 * schema) where an unwritable subschema makes the container unwritable too.
 */
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

/** Whether every `required` name still has a property to point at. */
function requiredNamesSurvive(node: Record<string, unknown>): boolean {
  if (!Array.isArray(node.required) || !isRecord(node.properties)) return true;
  const properties = node.properties;
  return node.required.every((name) => typeof name !== "string" || name in properties);
}

/** Expand one schema node, unrolling references until `budget` runs out. */
function expand(
  node: JSONSchema7Definition,
  budget: number,
  rewriter: Rewriter,
): Expansion<JSONSchema7Definition> {
  // The boolean shorthand passes through verbatim. `false` here is the author's
  // own "nothing matches" and is meaningful where it sits - `additionalProperties:
  // false` closes an object and appears on nearly every converted schema - so it
  // is emphatically not the unsatisfiable sentinel, which means "this branch could
  // not be WRITTEN within the budget".
  if (typeof node === "boolean") return written(node);
  if (typeof node.$ref === "string") return expandRef(node, node.$ref, budget, rewriter);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // The original definition blocks are raw material, not output: every
    // reference into them is rewritten to this document's own `$defs`.
    if (key === "definitions" || key === "$defs") continue;
    const expanded = expandKeyword(key, value, budget, rewriter);
    if (expanded.value === undefined) return UNSATISFIABLE;
    out[key] = expanded.value;
  }

  // A required property dropped by `expandMap` above leaves an object no
  // instance can satisfy, so the object goes rather than becoming quietly wrong.
  return requiredNamesSurvive(out) ? written(out as JSONSchema7Definition) : UNSATISFIABLE;
}

/**
 * Rewrite a converted tool schema into a self-contained, acyclic document.
 *
 * Returns a schema whose every `$ref` names an entry in its own `$defs`, with no
 * entry reachable from itself. A schema that has no references is returned
 * unchanged apart from the walk, so the three non-recursive tools pay nothing.
 *
 * Throws if the result is unsatisfiable at the root, which would mean the whole
 * tool input is unwritable at this depth: that is a programming error rather
 * than a runtime condition, and failing at composition time is better than
 * shipping a tool no model can call.
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

/**
 * Every `$ref` in `schema`, paired with whether it resolves inside `schema`.
 *
 * Exported for the regression pin: the fake provider never reads a tool schema,
 * so nothing in the suite converted one until issue #820 was found by a real
 * engine rejecting the tool set. `tools.test.ts` walks every emitted schema
 * through this and requires each reference to land.
 */
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
