// @ts-check
/**
 * The assistant's prompt text, read by one gate and excluded by another, so both names
 * come from here and cannot disagree.
 */

/** Keep the trailing slash: a sibling of `prompts/` is ordinary source. */
export const PROMPT_SOURCE_PREFIX = "apps/api/src/features/agent/prompts/";

/** The directories holding prompt text, each one Markdown file per entry. */
export const PROMPT_SOURCE_DIRS = ["system", "tools", "actions", "recipes"];

/** The as-sent view of the prompt, written by the agent's tests and read as a diff. */
export const PROMPT_RENDERED_PREFIX = `${PROMPT_SOURCE_PREFIX}rendered/`;

/**
 * @param {string} file repo-relative path
 * @returns {boolean}
 */
export function isRenderedPrompt(file) {
  return file.startsWith(PROMPT_RENDERED_PREFIX);
}

/**
 * A Markdown file the model reads as bytes. Prettier rewrites Markdown emphasis and
 * wrapping, which would edit the prompt, so these are outside it and inside
 * `pnpm check:prompts`, `pnpm check:no-em-dash` and the agent's own tests.
 *
 * @param {string} file repo-relative path
 * @returns {boolean}
 */
export function isPromptSource(file) {
  return PROMPT_SOURCE_DIRS.some((dir) => file.startsWith(`${PROMPT_SOURCE_PREFIX}${dir}/`));
}
