export interface TermHit {
  readonly term: string;
  readonly match: string;
  readonly index: number;
}

export interface TextHit {
  readonly match: string;
  readonly index: number;
}

export declare const PROMPT_AVOID_WORDS: readonly string[];
export declare const PROMPT_SOURCE: string;
export declare const REVIEW_ONLY_TERMS: readonly string[];
export declare const FORBIDDEN_TERMS: readonly string[];
export declare const ID_PREFIXES: readonly string[];
export declare const ID_PATTERN: RegExp;

export declare function termPattern(term: string): RegExp;

export declare function findForbiddenTerms(text: string, terms?: readonly string[]): TermHit[];

export declare function findIdentifiers(text: string): TextHit[];

export declare function firstSentence(text: string): string;

export declare function stripSpeakerLabel(text: string): string;

/** `null` when the opening sentence is within what the prompt allows. */
export declare function openingFault(spoken: string): string | null;

export declare function selfClaims(text: string): TextHit[];
