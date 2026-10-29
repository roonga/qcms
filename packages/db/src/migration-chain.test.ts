import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `drizzle-kit generate` diffs against the newest snapshot and nothing reads one at migration time, so a
 * missing one breaks nothing until the next `generate`. `readdirSync` because lint forbids resolving a
 * command off `PATH`.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** drizzle-kit's "no predecessor" sentinel, on the first snapshot only. */
const NO_PREVIOUS_SNAPSHOT = "00000000-0000-0000-0000-000000000000";

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Snapshot {
  readonly id: string;
  readonly prevId: string;
}

function journalEntries(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

function prefixOf(idx: number): string {
  return String(idx).padStart(4, "0");
}

/** A migration comment naming `DROP` would otherwise fail the checks below. */
function inComment(sql: string, index: number | undefined): boolean {
  if (index === undefined) return false;
  const lineStart = sql.lastIndexOf("\n", index) + 1;
  const commentStart = sql.indexOf("--", lineStart);
  return commentStart !== -1 && commentStart < index;
}

function fileNames(subdirectory = ""): string[] {
  return readdirSync(`${MIGRATIONS_DIR}${subdirectory}`, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

describe("the migration chain is complete", () => {
  const entries = journalEntries();

  it("has a journal to reason about", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });

  it("has a baseline carrying no DROP and no SET SCHEMA at all (Q41, criterion 8)", () => {
    const baseline = entries[0];
    expect(baseline).toBeDefined();
    const sql = readFileSync(`${MIGRATIONS_DIR}${baseline!.tag}.sql`, "utf8");
    const offending = [...sql.matchAll(/\b(drop|set\s+schema)\b/gi)]
      .filter((match) => !inComment(sql, match.index))
      .map((match) => match[0]);
    expect(offending).toEqual([]);
  });

  it("drops no table, schema, view, trigger or function anywhere in the tree (Q41, criterion 8)", () => {
    // An appended migration may drop a column, type, index or constraint, but a trigger
    // or function holds an invariant, so dropping one retires it while every table and
    // column still stands.
    const offending = fileNames()
      .filter((name) => name.endsWith(".sql"))
      .flatMap((name) => {
        const sql = readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");
        return [
          ...sql.matchAll(
            /\b(drop\s+(table|schema|(materialized\s+)?view|trigger|function)|set\s+schema)\b/gi,
          ),
        ]
          .filter((match) => !inComment(sql, match.index))
          .map((match) => `${name}: ${match[0]}`);
      });
    expect(offending).toEqual([]);
  });

  it("has the SQL file every journal entry names", () => {
    const present = new Set(fileNames());
    const missing = entries
      .filter((entry) => !present.has(`${entry.tag}.sql`))
      .map((entry) => `${entry.idx}: ${entry.tag}.sql`);
    expect(missing).toEqual([]);
  });

  it("has the snapshot every journal entry needs", () => {
    const present = new Set(fileNames("meta"));
    const missing = entries
      .filter((entry) => !present.has(`${prefixOf(entry.idx)}_snapshot.json`))
      .map((entry) => `${prefixOf(entry.idx)}_snapshot.json (${entry.tag})`);
    expect(missing).toEqual([]);
  });

  it("links each snapshot to the one before it", () => {
    const chain = entries.map((entry) => ({
      idx: entry.idx,
      snapshot: JSON.parse(
        readFileSync(`${MIGRATIONS_DIR}meta/${prefixOf(entry.idx)}_snapshot.json`, "utf8"),
      ) as Snapshot,
    }));
    const broken: string[] = [];
    for (const [position, link] of chain.entries()) {
      const expectedPrevious =
        position === 0 ? NO_PREVIOUS_SNAPSHOT : chain[position - 1]?.snapshot.id;
      if (link.snapshot.prevId !== expectedPrevious) {
        broken.push(
          `${prefixOf(link.idx)} names ${link.snapshot.prevId} as its predecessor, not ${String(expectedPrevious)}`,
        );
      }
    }
    expect(broken).toEqual([]);
  });

  it("carries no snapshot the journal does not account for", () => {
    const accounted = new Set([
      "_journal.json",
      ...entries.map((entry) => `${prefixOf(entry.idx)}_snapshot.json`),
    ]);
    expect(fileNames("meta").filter((name) => !accounted.has(name))).toEqual([]);
  });

  it("carries no migration SQL the journal does not account for", () => {
    // drizzle-kit names migrations randomly, so each one is renamed by hand in two
    // places: the file and its journal `tag`.
    const accounted = new Set(entries.map((entry) => `${entry.tag}.sql`));
    expect(fileNames().filter((name) => !accounted.has(name))).toEqual([]);
  });
});
