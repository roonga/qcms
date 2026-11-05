import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

const COMPONENTS_ROOT = dirname(fileURLToPath(import.meta.url));

const HANDLERS: Readonly<Record<string, readonly string[]>> = {
  "forms/draft-preview.tsx": ["preview projection (forms/draft-preview-rejects.test.tsx)"],
  "forms/release-panel.tsx": ["release (forms/release-panel-rejects.test.tsx)"],
  "forms/publish-wizard.tsx": [
    "read the review (forms/publish-wizard-rejects.test.tsx)",
    "confirm, whose lost answer is uncertain (forms/publish-wizard-rejects.test.tsx)",
    "look the recorded result up (forms/publish-wizard-rejects.test.tsx)",
  ],
  "forms/release-version-review.tsx": [
    "read the immutable candidate (forms/release-version-review.test.tsx)",
  ],
  "forms/public-form-link.tsx": [
    "copy the public address (forms/public-form-link-rejects.test.tsx)",
  ],
  "forms/secure-links.tsx": [
    "mint (forms/secure-links-rejects.test.tsx)",
    "revoke (forms/secure-links-rejects.test.tsx)",
    "copy a minted URL (forms/secure-links-rejects.test.tsx)",
  ],
  "ops/dead-letters.tsx": ["redeliver, single and bulk (ops/dead-letters-rejects.test.tsx)"],
  "ops/endpoint-proposals.tsx": [
    "confirm and withdraw a pending prod endpoint change (ops/endpoint-proposals.test.tsx)",
  ],
  "ops/form-intake.tsx": ["close/reopen (ops/form-intake-rejects.test.tsx)"],
  "ops/known-target-erasure.tsx": [
    "look a session up (ops/known-target-erasure.test.tsx)",
    "erase (ops/known-target-erasure.test.tsx)",
  ],
  "ops/response-detail.tsx": [
    "release a withheld event (ops/response-detail-rejects.test.tsx)",
    "erase (ops/response-detail-rejects.test.tsx)",
  ],
  "ops/webhook-config.tsx": [
    "create, rotate, deactivate, reactivate, retarget (ops/webhook-config-rejects.test.tsx)",
    "copy a revealed secret (ops/webhook-config-rejects.test.tsx)",
  ],
};

/* Enumerate tracked files recursively; directory walks include scratch/build files, and one-level reads
   miss nested handlers. */
function componentFiles(): readonly string[] {
  return trackedFilesUnder(COMPONENTS_ROOT, { match: /^(?:forms|ops)\/.+\.tsx$/ }).filter(
    (path) => !path.endsWith(".test.tsx"),
  );
}

function catchSites(relative: string): number {
  const source = readFileSync(join(COMPONENTS_ROOT, relative), "utf8");
  return source.split(".catch(").length - 1;
}

describe("the rejection handlers of the admin's forms and ops components", () => {
  it("are exactly the ones a rendered test drives", () => {
    const found: Record<string, number> = {};
    for (const file of componentFiles()) {
      const count = catchSites(file);
      if (count > 0) found[file] = count;
    }

    const declared = Object.fromEntries(
      Object.entries(HANDLERS).map(([file, entries]) => [file, entries.length]),
    );

    expect(found).toStrictEqual(declared);
  });

  it("number nineteen, of which sixteen are action rejections (nine at issue #352)", () => {
    const entries = Object.values(HANDLERS).flat();
    expect(entries).toHaveLength(19);

    const clipboard = entries.filter((entry) => entry.startsWith("copy"));
    expect(clipboard).toHaveLength(3);

    expect(entries.length - clipboard.length).toBe(16);
  });
});
