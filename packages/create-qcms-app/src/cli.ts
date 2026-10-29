#!/usr/bin/env node
/** The bin entry point; everything else lives in `run.ts`, which is importable without side effects. */

import { main } from "./run.js";

process.exitCode = await main(process.argv.slice(2), process.cwd());
