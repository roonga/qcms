#!/usr/bin/env node
/**
 * `pnpm create qcms-app my-forms` (task 037).
 *
 * The bin entry point, and nothing else: everything it does lives in `run.ts`, which
 * is importable without side effects and therefore testable.
 */

import { main } from "./run.js";

process.exitCode = await main(process.argv.slice(2), process.cwd());
