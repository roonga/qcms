/** `line` is 1-based. */
export interface ColourHit {
  readonly line: number;
  readonly hit: string;
}

/** `line` is 1-based. */
export interface CatalogValue {
  readonly line: number;
  readonly text: string;
}

export declare const LANDED_SHEET: string;
export declare const PLAN_SHEET: string;
export declare const CATALOG: string;

export declare function stripComments(text: string, includeLineComments: boolean): string;

export declare function literalColourFunctions(line: string): string[];

export declare function findLiteralColours(text: string): ColourHit[];

export declare function catalogValues(source: string): CatalogValue[];

export declare function checkAdminTheme(): string[];
