/**
 * Count what the browser console actually said, by level, without touching the gate
 * (issue #162).
 *
 * ## The friction this removes
 *
 * Changing or reviewing the browser gate means knowing which console messages a run
 * really produces and at which level. There was no way to get that: on #147 both the
 * executor and the reviewer hand-patched `gates.ts` with a temporary recorder,
 * independently, each burning a full suite run plus a patch-and-revert cycle. The
 * reviewer had to EDIT THE FILE UNDER REVIEW in order to review it, then revert and
 * re-verify the tree was clean.
 *
 * The data is not derivable by reading code. #147's whole design rested on two
 * measured facts - that the `eval()` shape arrives as `console.error` rather than
 * `warn`, so it was already gated (which corrected the issue's own framing), and
 * that 25 live `warning` events corresponded to 25 forwarded `WARN:` lines in
 * `portal.log`, which is what made the live console stream the right surface to gate.
 * Guess either one wrong and you ship a gate that gates nothing.
 *
 * ## Why a spec-scoped helper rather than a hook inside the gate
 *
 * #162 sketched an env-gated recorder inside `browserGuard`
 * (`QCMS_E2E_CONSOLE_CENSUS=<file>`). This is the same census with the mechanism
 * inverted, and it is better on the two properties the issue actually cares about:
 *
 * - **It cannot alter a gate verdict**, and that is true BY CONSTRUCTION rather than
 *   by inspection. It attaches its own `page.on("console")` listener and touches no
 *   gate state; Playwright fans an event out to every listener, so nothing here can
 *   consume, reorder, or suppress a message the gate also sees. A recorder living
 *   inside `browserGuard` would need that argued and re-argued at every edit.
 * - **The file under review stays unedited.** A reviewer measuring the gate's
 *   behaviour adds a call in a spec, or writes a throwaway spec, and `gates.ts`
 *   keeps whatever bytes it had.
 *
 * It also sidesteps the turbo strict-env trap #150 records, in which a new `QCMS_*`
 * variable consumed by a subprocess under `turbo` is silently stripped unless it is
 * declared in `globalPassThroughEnv` - and "it is set in the job" is not evidence it
 * arrived. There is no new variable here to strip.
 *
 * The trade is honest and worth stating: this censuses ONE spec's scope, not a whole
 * suite run in one pass. That is the scope a gate question has generally needed
 * (both #147 measurements were per-surface), and a whole-suite census remains
 * available by calling this from a fixture or a temporary spec. If a future question
 * genuinely needs every spec at once, the env-gated hook is still the right shape and
 * this comment is the argument for why it was not needed first.
 *
 * ## Level as typed data
 *
 * The level is `ConsoleMessage["type"]`, Playwright's own union, never a prefix
 * re-parsed out of the text - telling `error` from `warn` is the whole reason the
 * census exists, and Playwright spells `console.warn` as `"warning"` (the DevTools
 * protocol name), which is exactly the sort of thing a text parse gets wrong.
 *
 * ## Usage
 *
 * ```ts
 * const census = censusConsole(page);
 * await startAnonymousFlow(page, slug);
 * console.log(census.report());          // levels and counts, most frequent first
 * census.of("warning");                  // every warn message, as text
 * census.byLevel().get("error") ?? 0;    // one level's count
 * ```
 *
 * `a11y-error-summary.pw.ts` carries a live example. Documented for reviewers in
 * `docs/DEVELOPER_GUIDE.md` alongside the gate notes.
 */

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
