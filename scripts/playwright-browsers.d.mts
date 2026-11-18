export interface PinnedBuilds {
  root: string;
  builds: string[];
}

export type BrowserInstallRunner = (
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) => { status: number | null; error?: Error };

export declare const SKIP_GC_ENV: string;

export declare const CHECKED_ENV: string;

export declare function pinnedBuilds(executablePath: string | undefined): PinnedBuilds | undefined;

export declare function missingBuilds(pinned: PinnedBuilds): string[];

export declare function installBrowsers(options?: {
  run?: BrowserInstallRunner;
  environment?: NodeJS.ProcessEnv;
}): void;

export declare function ensureBrowsers(options?: {
  executablePath?: string;
  run?: BrowserInstallRunner;
  environment?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
}): { checked: boolean; installed: boolean; missing: string[] };

export declare function cacheBuilds(root: string): string[];

export declare function parseArgs(args: string[]): { mode: "install" | "prune"; apply: boolean };

export declare function prune(options: {
  pinned?: PinnedBuilds;
  apply: boolean;
  run?: BrowserInstallRunner;
  environment?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
}): number;

export declare function main(args: string[], executablePath: string | undefined): number;
