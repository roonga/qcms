import { readFileSync } from "node:fs";

import type { PortalFixtures } from "./api-server.js";
import { FIXTURES_PATH } from "./harness-config.js";

export type { PortalFixtures };

/** Read the fixtures written by globalSetup. Call inside a test or `beforeAll`. */
export function readFixtures(): PortalFixtures {
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as PortalFixtures;
}
