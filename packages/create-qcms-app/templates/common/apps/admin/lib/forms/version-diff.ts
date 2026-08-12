/**
 * A readable definition diff between two published versions (task 034).
 *
 * ## Why a text diff of canonical JSON, and not a structural one
 *
 * A structural diff would have to know what a step, a pin and a rule mean, which is domain
 * knowledge the admin is not allowed to hold (R2) and would be a second model of the DSL
 * to keep in step with the kernel's. A line diff over *canonically printed* JSON needs no
 * such knowledge and still reads well, because the printing is what does the work: keys
 * are emitted in sorted order, so a difference in the order two versions happened to
 * serialize their keys never shows up as a change, and only real content moves a line.
 *
 * ## Readable without colour
 *
 * Every row carries a `marker` (`+`, `-`, or a space), and the marker is text in the
 * rendered output rather than a class name. WCAG 1.4.1: a reader who cannot distinguish
 * the two column tints still reads the diff correctly.
 */

/** One aligned row of the side-by-side diff. */
export interface DiffRow {
  /** The line as the older version has it, or `null` where the older version has none. */
  readonly left: string | null;
  /** The line as the newer version has it, or `null` where the newer version has none. */
  readonly right: string | null;
  readonly kind: "same" | "added" | "removed";
  /** The textual marker, so the diff never depends on colour alone. */
  readonly marker: "+" | "-" | " ";
}

export interface VersionDiff {
  readonly rows: readonly DiffRow[];
  readonly added: number;
  readonly removed: number;
  /** True when the two definitions print identically (a republish with no edits). */
  readonly identical: boolean;
  /**
   * True when one side was too large to align, in which case `rows` is empty.
   *
   * The alignment is quadratic, and a form definition that runs to thousands of lines is
   * both unusual and exactly the input that would make a browser tab stop responding. The
   * screen says so rather than hanging.
   */
  readonly tooLarge: boolean;
}

/** The largest definition (in printed lines) the aligner will attempt. */
const MAX_DIFF_LINES = 1500;

/**
 * Print a value as canonical JSON: sorted keys, two-space indent, one line per token.
 *
 * Sorting is applied at every level and to objects only. Array order is content, never
 * formatting, so it is preserved: reordering two steps is a real edit and must show up.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = canonical(source[key]);
  }
  return sorted;
}

/** The printed lines of one definition, or a single line when it cannot be printed. */
export function definitionLines(definition: unknown): readonly string[] {
  try {
    return JSON.stringify(canonical(definition), null, 2)?.split("\n") ?? [];
  } catch {
    return [];
  }
}

/** The length of the longest common subsequence prefix table for two line arrays. */
function lcsTable(left: readonly string[], right: readonly string[]): Int32Array[] {
  const table: Int32Array[] = [];
  for (let i = 0; i <= left.length; i += 1) table.push(new Int32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    const row = table[i] as Int32Array;
    const next = table[i + 1] as Int32Array;
    for (let j = right.length - 1; j >= 0; j -= 1) {
      row[j] =
        left[i] === right[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  return table;
}

const SAME = (line: string): DiffRow => ({ left: line, right: line, kind: "same", marker: " " });
const REMOVED = (line: string): DiffRow => ({
  left: line,
  right: null,
  kind: "removed",
  marker: "-",
});
const ADDED = (line: string): DiffRow => ({ left: null, right: line, kind: "added", marker: "+" });

/**
 * Walk the LCS table into aligned rows.
 *
 * A removal and an addition at the same point stay separate rows rather than being merged
 * into one "changed" row. That is deliberate: merging looks tidier and hides which side a
 * line came from when the two differ in length, and the author's question here is always
 * "what is in the new version that was not in the old", which separate rows answer
 * directly.
 */
function alignRows(left: readonly string[], right: readonly string[]): DiffRow[] {
  const table = lcsTable(left, right);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push(SAME(left[i] as string));
      i += 1;
      j += 1;
      continue;
    }
    const down = (table[i + 1] as Int32Array)[j] as number;
    const across = (table[i] as Int32Array)[j + 1] as number;
    if (down >= across) {
      rows.push(REMOVED(left[i] as string));
      i += 1;
    } else {
      rows.push(ADDED(right[j] as string));
      j += 1;
    }
  }
  for (; i < left.length; i += 1) rows.push(REMOVED(left[i] as string));
  for (; j < right.length; j += 1) rows.push(ADDED(right[j] as string));
  return rows;
}

/** Diff two version definitions into aligned, marker-carrying rows. */
export function diffDefinitions(older: unknown, newer: unknown): VersionDiff {
  const left = definitionLines(older);
  const right = definitionLines(newer);
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    return { rows: [], added: 0, removed: 0, identical: false, tooLarge: true };
  }

  const rows = alignRows(left, right);
  const added = rows.filter((row) => row.kind === "added").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  return { rows, added, removed, identical: added === 0 && removed === 0, tooLarge: false };
}
