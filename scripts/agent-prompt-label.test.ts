import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/agent-prompt-label.yml", import.meta.url)),
  "utf8",
);

describe("agent-prompt label workflow", () => {
  it("fires only for changes under the prompts folder", () => {
    expect(workflow).toMatch(/paths:\n\s+- apps\/api\/src\/features\/agent\/prompts\/\*\*/);
  });

  it("applies the agent-prompt label", () => {
    expect(workflow).toContain("--add-label agent-prompt");
  });

  it("holds the narrowest token and never runs pull request code", () => {
    expect(workflow).toMatch(/^permissions:\n {2}pull-requests: write\n/m);
    expect(workflow).not.toMatch(/\bcontents:/);
    expect(workflow).not.toMatch(/uses:/);
    expect(workflow).not.toMatch(/\bpnpm\b|\bnpm\b|checkout/);
  });
});
