/**
 * The last thing the operator reads (task 037, deliverable "post-scaffold smoke").
 *
 * The commands here are the exact commands the scaffolded README carries, in the same
 * order, because a final message that paraphrases the README is how the two drift.
 * The "closing message and the README" suite in `scaffold.test.ts` asserts every
 * command below appears verbatim in the rendered README of BOTH deployment shapes, so
 * a change to either has to be a change to both.
 */

import type { ScaffoldOptions } from "./options.js";

/** The five commands, in the order they must be run. */
export function nextCommands(options: ScaffoldOptions): readonly string[] {
  return [
    `cd ${options.projectName}`,
    "$EDITOR .env",
    "docker compose up -d --build",
    "docker compose run --rm migrate",
    "docker compose exec \\\n" +
      "  -e QCMS_ADMIN_EMAIL=you@example.com \\\n" +
      "  -e QCMS_ADMIN_PASSWORD='a long passphrase' \\\n" +
      "  api node dist/create-admin.js",
  ];
}

/** The whole closing message, including anything `.env` still needs. */
export function nextSteps(options: ScaffoldOptions, unresolvedEnv: readonly string[]): string {
  const [cd, editor, up, migrate, createAdmin] = nextCommands(options);
  const lines = [
    "",
    `Scaffolded ${options.projectName} (${options.shape} shape).`,
    "",
    "The three apps under apps/ are yours to edit. The four @roonga/qcms-* packages they",
    "depend on are versioned dependencies you upgrade. See README.md.",
    "",
    "Next:",
    "",
    `  ${cd}`,
    "",
    "  # 1. Review the environment. Secrets were generated for you; check the URLs.",
    `  ${editor}`,
    "",
    "  # 2. Build the images, run the migrations, start the stack.",
    `  ${up}`,
    "",
    "  # 3. Migrations are always their own step, repeated after every upgrade.",
    `  ${migrate}`,
    "",
    "  # 4. Create the first administrator (credentials travel in the environment,",
    "  #    never as arguments).",
    ...(createAdmin ?? "").split("\n").map((line) => `  ${line}`),
    "",
    `  # 5. Open the admin and sign in: ${options.adminBaseUrl}`,
    `  #    The respondent portal is at ${options.portalBaseUrl}`,
    "",
  ];
  if (unresolvedEnv.length > 0) {
    lines.push(`Before step 2, set these in .env: ${unresolvedEnv.join(", ")}`, "");
  }
  return lines.join("\n");
}
