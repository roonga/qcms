import type { ConsoleMessage, Page } from "@playwright/test";

/** Playwright's own console level union, so a caller cannot invent a level. */
export type ConsoleLevel = ReturnType<ConsoleMessage["type"]>;

/** One observed message, with its level kept as data. */
export interface CensusedMessage {
  readonly level: ConsoleLevel;
  readonly text: string;
  /** The resource that logged it, which is what tells one `eval()` shape from another. */
  readonly url: string;
}

/** A running census of one page's console, for the scope the caller opened it in. */
export interface ConsoleCensus {
  /** Every message observed so far, in the order the browser produced them. */
  readonly messages: () => readonly CensusedMessage[];
  /** How many messages arrived at each level, levels with none omitted. */
  readonly byLevel: () => ReadonlyMap<ConsoleLevel, number>;
  /** The text of every message at one level. */
  readonly of: (level: ConsoleLevel) => readonly string[];
  /** A one-line-per-level summary, most frequent first, for printing. */
  readonly report: () => string;
  /** Stop observing. Optional: the listener dies with the page anyway. */
  readonly stop: () => void;
}

/**
 * Start counting `page`'s console messages by level.
 *
 * Call it BEFORE the navigation whose messages you want; a listener attached later
 * sees nothing that already happened, and a census that quietly missed the load is
 * worse than no census. It never asserts and never fails a test.
 */
export function censusConsole(page: Page): ConsoleCensus {
  const observed: CensusedMessage[] = [];
  const listener = (message: ConsoleMessage): void => {
    observed.push({
      level: message.type(),
      text: message.text(),
      url: message.location().url,
    });
  };
  page.on("console", listener);

  const byLevel = (): ReadonlyMap<ConsoleLevel, number> => {
    const counts = new Map<ConsoleLevel, number>();
    for (const entry of observed) counts.set(entry.level, (counts.get(entry.level) ?? 0) + 1);
    return counts;
  };

  return {
    messages: () => observed.slice(),
    byLevel,
    of: (level) => observed.filter((entry) => entry.level === level).map((entry) => entry.text),
    report: () => {
      const rows = [...byLevel()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (rows.length === 0) return "console census: no messages";
      return ["console census:", ...rows.map(([level, count]) => `  ${level}: ${count}`)].join(
        "\n",
      );
    },
    stop: () => {
      page.off("console", listener);
    },
  };
}
