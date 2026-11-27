export interface StatusStack {
  readonly adminUrl: string;
  readonly promptVersion?: string;
  readonly headSha?: string;
}

export interface NewScenario {
  readonly id: string;
  readonly title: string;
  readonly budget: number;
}

export interface NewRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly stack: StatusStack;
  readonly scenarios: readonly NewScenario[];
}

export declare const STATUS_FILE_NAME: string;
export declare const STATES: readonly string[];
export declare const SEVERITIES: readonly string[];
export declare const VERDICTS: readonly string[];
export declare const FINDING_KINDS: readonly string[];
export declare const MAX_TEXT: number;

export declare function createStatus(run: NewRun): Record<string, unknown>;

export declare function withScenario(
  status: Record<string, unknown>,
  id: string,
  patch: Record<string, unknown>,
  now: string,
): Record<string, unknown>;

export declare function validateStatus(value: unknown): string[];

export declare function assertValid(value: unknown): Record<string, unknown>;

export declare function writeStatus(path: string, status: Record<string, unknown>): string;

export declare function readStatus(path: string): Record<string, unknown>;

export declare function main(args: readonly string[], now: string): number;
