// @ts-check
/**
 * Where the assistant's prompt text lives. The generator and every gate that reads or
 * skips those files take the names from here, so they cannot disagree about the path.
 */

/** Keep the trailing slash: a sibling of `prompts/` is ordinary source. */
export const PROMPT_SOURCE_PREFIX = "apps/api/src/features/agent/prompts/";

/** The directories holding prompt text, each one Markdown file per entry. */
export const PROMPT_SOURCE_DIRS = ["system", "tools", "actions", "recipes"];
