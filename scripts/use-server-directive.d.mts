/** Type declarations for the shared `"use server"` directive scan (task 073). */

/**
 * Whether a module's FIRST statement is the `"use server"` directive, skipping leading
 * whitespace and leading line or block comments. Linear in the source's length.
 */
export function declaresUseServer(source: string): boolean;
