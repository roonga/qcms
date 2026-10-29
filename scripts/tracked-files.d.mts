export interface TrackedFilesOptions {
  /** Must not carry the `g` or `y` flag: `test` is stateful on those and drops paths. */
  readonly match?: RegExp;
}

/**
 * Tracked files plus new unignored ones, so an unstaged source file is still in scope.
 * Throws when `root` is not a directory, when `match` is global or sticky, and when git
 * lists nothing under it.
 */
export declare function trackedFilesUnder(root: string, options?: TrackedFilesOptions): string[];
