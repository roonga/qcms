export interface FixtureDomainHit {
  readonly file: string;
  readonly term: string;
}

export declare const DENYLIST: readonly string[];

export declare const FIXTURE_DIR: string;

export declare function scanText(label: string, text: string): FixtureDomainHit[];

export declare function scanFixtureDir(dir?: string): FixtureDomainHit[];
