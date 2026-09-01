/** Type declarations for the shared tree-enumeration helper (issues #635, #641). */

/** Options for {@link trackedFilesUnder}. */
export interface TrackedFilesOptions {
  /**
   * Tested against each path relative to `root`; only matching paths are returned.
   *
   * Must not carry the `g` or `y` flag: `test` is stateful on those and would drop paths.
   */
  readonly match?: RegExp;
}

/**
 * Every file git knows about under `root` (tracked, plus new and not ignored), as
 * slash-separated paths relative to `root`, sorted.
 *
 * Throws when `root` is not a directory, when `match` is global or sticky, and when git
 * lists nothing under it.
 */
export declare function trackedFilesUnder(root: string, options?: TrackedFilesOptions): string[];
