import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The migration set, its journal and its snapshot chain agree (issue #780).
 *
 * ## What this is for
 *
 * `drizzle-kit generate` diffs the schema source against the **newest committed
 * snapshot**, so the snapshots are how the generator knows what a database already
 * has. `0017_account_issuer` shipped without one. Nothing noticed, because nothing
 * reads a snapshot at migration time: the migrator resolves the journal and the SQL,
 * so every test, every Testcontainers boot and every deployment kept working.
 *
 * The cost landed on the NEXT author. With 0017's snapshot missing, `generate` diffed
 * against 0016 and re-emitted 0017's `ADD COLUMN "issuer"` and its unique index on top
 * of the new migration, which applied to a database already at 0017 fails. That
 * duplicate reached a pull request (#779) and was caught by reading the generated SQL,
 * which is not a control.
 *
 * ## Why the whole chain and not just "the file exists"
 *
 * A snapshot carries `prevId`, and the generator walks it. Backfilling 0017 without
 * relinking 0018's `prevId` would leave a file on disk and a chain that still skips
 * it - present, and still wrong, which is the worse of the two states because it looks
 * fixed. So the property asserted is the chain: every journal entry has a snapshot,
 * every snapshot names its predecessor, and nothing sits in `meta/` that the journal
 * does not account for.
 *
 * ## Derivation
 *
 * The journal is the source of the migration set; the file listing is only ever used
 * to find what the journal does NOT account for. A hard-coded count would stop
 * covering migration 19 without saying so.
 *
 * `readdirSync` confined to `migrations/` rather than `git ls-files`: this package's
 * lint forbids resolving a command off `PATH`, and the same trade is already recorded
 * in `packages/db/src/import-manifest.test.ts`. The directory holds committed SQL and
 * JSON only, never build output, so the objection that makes a directory walk wrong
 * elsewhere in this repository does not apply here.
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

/** `17` as `"0017"`, the prefix both the SQL file and the snapshot are named by. */
function prefixOf(idx: number): string {
  return String(idx).padStart(4, "0");
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
    // The floor under every assertion below. An empty or unreadable journal would
    // leave each of them vacuously true, which is the shape #780 is about: a control
    // that reports nothing reads exactly like a control that found nothing wrong.
    expect(entries.length).toBeGreaterThan(18);
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });

  it("has the SQL file every journal entry names", () => {
    const present = new Set(fileNames());
    const missing = entries
      .filter((entry) => !present.has(`${entry.tag}.sql`))
      .map((entry) => `${entry.idx}: ${entry.tag}.sql`);
    expect(missing).toEqual([]);
  });

  it("has the snapshot every journal entry needs", () => {
    // The assertion #780 asks for. `0017_snapshot.json` was absent for two months and
    // this is the line that would have failed in 0017's own pull request.
    const present = new Set(fileNames("meta"));
    const missing = entries
      .filter((entry) => !present.has(`${prefixOf(entry.idx)}_snapshot.json`))
      .map((entry) => `${prefixOf(entry.idx)}_snapshot.json (${entry.tag})`);
    expect(missing).toEqual([]);
  });

  it("links each snapshot to the one before it", () => {
    // A snapshot that exists but is not in the chain is the half-fixed state: the file
    // is there, and `generate` still diffs against whatever `prevId` actually points
    // at. Backfilling 0017 without moving 0018's `prevId` off 0016 would pass the test
    // above and fail this one.
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
    // The other direction. A snapshot left behind by a migration that was withdrawn
    // would be diffed against by nothing and would mislead the next reader of `meta/`.
    const accounted = new Set([
      "_journal.json",
      ...entries.map((entry) => `${prefixOf(entry.idx)}_snapshot.json`),
    ]);
    expect(fileNames("meta").filter((name) => !accounted.has(name))).toEqual([]);
  });

  it("carries no migration SQL the journal does not account for", () => {
    // The correspondence between a filename and its journal `tag` is hand-maintained
    // (issue #428: drizzle-kit names migrations randomly, so every one is renamed in
    // two places). This half of it is free here: a rename that moved the file and not
    // the tag leaves an unaccounted file, and one that moved the tag and not the file
    // fails the SQL assertion above.
    const accounted = new Set(entries.map((entry) => `${entry.tag}.sql`));
    expect(fileNames().filter((name) => !accounted.has(name))).toEqual([]);
  });
});
