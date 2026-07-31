/** Type declarations for the QCMS app theme gates (task 055). */

/** One literal-colour hit: the 1-based line and the offending text. */
export interface ColourHit {
  readonly line: number;
  readonly hit: string;
}

/** One catalog value: the 1-based line and the string an operator reads. */
export interface CatalogValue {
  readonly line: number;
  readonly text: string;
}

/** Repo-relative path of the landed token sheet. */
export declare const LANDED_SHEET: string;
/** Repo-relative path of the design copy the landed sheet is generated from. */
export declare const PLAN_SHEET: string;
/** Repo-relative path of the app's message catalog. */
export declare const CATALOG: string;

/** Blank out comments, preserving newlines so line numbers still line up. */
export declare function stripComments(text: string, includeLineComments: boolean): string;

/** Colour-function calls in one line that do not reach a `var(--...)` token. */
export declare function literalColourFunctions(line: string): string[];

/** Every literal colour in one file's comment-stripped source. */
export declare function findLiteralColours(text: string): ColourHit[];

/** Every quoted value in the message catalog, excluding keys and comments. */
export declare function catalogValues(source: string): CatalogValue[];

/** Run all three checks against the repository; empty means clean. */
export declare function checkAdminTheme(): string[];
