import { z } from "zod";

/**
 * The ADR-32 `messages` prop lives in a wrapper because every vendored props object is `.strict()` and ADR-22
 * freezes them. The key set restates the kernel's `ValidationMessageKey` rather than importing it, so the client
 * bundle stays kernel-free; the golden corpus proves the two agree.
 */
export const AuthorMessagesSchema = z
  .object({
    required: z.string().optional(),
    minLength: z.string().optional(),
    maxLength: z.string().optional(),
    pattern: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    integer: z.string().optional(),
    minSelected: z.string().optional(),
    maxSelected: z.string().optional(),
  })
  .strict();

export type AuthorMessages = z.infer<typeof AuthorMessagesSchema>;

/** The `messages` prop of a compiled control node, or `undefined`. */
export function authorMessagesOf(props: unknown): AuthorMessages | undefined {
  if (typeof props !== "object" || props === null) return undefined;
  const messages = (props as { messages?: unknown }).messages;
  if (messages === undefined) return undefined;
  const parsed = AuthorMessagesSchema.safeParse(messages);
  return parsed.success ? parsed.data : undefined;
}

function withoutAuthorMessages(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const props = (node as { props?: unknown }).props;
  if (typeof props !== "object" || props === null || !("messages" in props)) return node;
  const rest: Record<string, unknown> = { ...(props as Record<string, unknown>) };
  delete rest.messages;
  return { ...(node as Record<string, unknown>), props: rest };
}

/** Wraps a vendored control schema so it also accepts the `messages` prop. */
export function withAuthorMessages(vendored: z.ZodType): z.ZodType<unknown> {
  return z.unknown().superRefine((node, ctx) => {
    const props =
      typeof node === "object" && node !== null ? (node as { props?: unknown }).props : undefined;
    const messages =
      typeof props === "object" && props !== null
        ? (props as { messages?: unknown }).messages
        : undefined;
    // Re-issued as `custom` because zod's per-code issue types are not re-addable
    // verbatim across schemas.
    const reissue = (error: z.ZodError, prefix: readonly PropertyKey[]): void => {
      for (const issue of error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: [...prefix, ...issue.path],
        });
      }
    };
    if (messages !== undefined) {
      const parsed = AuthorMessagesSchema.safeParse(messages);
      if (!parsed.success) reissue(parsed.error, ["props", "messages"]);
    }
    const upstream = vendored.safeParse(withoutAuthorMessages(node));
    if (!upstream.success) reissue(upstream.error, []);
  });
}
