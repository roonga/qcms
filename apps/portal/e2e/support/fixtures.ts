/**
 * The fixtures reader for the portal specs (task 029).
 *
 * globalSetup writes `apps/portal/.playwright/fixtures.json` (the seeded form slug
 * and one link token per outcome) before any test runs; specs read it here. The
 * type import is erased at runtime (verbatimModuleSyntax), so pulling it in never
 * executes the API-boot module in a test worker.
 */

import { readFileSync } from "node:fs";

import type { PortalFixtures } from "./api-server.js";
import { FIXTURES_PATH } from "./harness-config.js";

export type { PortalFixtures };

/** Read the fixtures written by globalSetup. Call inside a test or `beforeAll`. */
export function readFixtures(): PortalFixtures {
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as PortalFixtures;
}
