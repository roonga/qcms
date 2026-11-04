// Canonical JSON comparison avoids putting a second domain model in the BFF.

export interface DiffRow {
  readonly left: string | null;

  readonly right: string | null;
  readonly kind: "same" | "added" | "removed";

  readonly marker: "+" | "-" | " ";
}

export interface VersionDiff {
  readonly rows: readonly DiffRow[];
  readonly added: number;
  readonly removed: number;

  readonly identical: boolean;
  // Bound the quadratic aligner so a large definition cannot freeze the browser tab.
  readonly tooLarge: boolean;
}

const MAX_DIFF_LINES = 1500;

// Sort object keys for stable comparison; preserve array order because moving steps is a real edit.
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

export function definitionLines(definition: unknown): readonly string[] {
  try {
    return JSON.stringify(canonical(definition), null, 2)?.split("\n") ?? [];
  } catch {
    return [];
  }
}

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
