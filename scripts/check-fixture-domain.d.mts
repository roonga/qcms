/** Type declarations for the fixture-content guard (task 045). */

/** One denylist hit: the fixture file (label) and the term found in it. */
export interface FixtureDomainHit {
  readonly file: string;
  readonly term: string;
}

/** Case-insensitive denylist of health/sensitive substrings. */
export declare const DENYLIST: readonly string[];

/** Absolute path of the scanned example-form fixture directory. */
export declare const FIXTURE_DIR: string;

/** Return every denylist term found (case-insensitively) in `text`. */
export declare function scanText(label: string, text: string): FixtureDomainHit[];

/** Scan every `.json` file in `dir` (defaults to {@link FIXTURE_DIR}). */
export declare function scanFixtureDir(dir?: string): FixtureDomainHit[];
