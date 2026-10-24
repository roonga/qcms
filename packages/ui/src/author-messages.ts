import { z } from "zod";

/**
 * The qcms-side node-prop extension for author-supplied validation messages (ADR-32).
 *
 * The author's per-constraint wording rides on the control node as a `messages` prop,
 * but every `@a2ra/core` control props object is `.strict()` and the vendored schemas
 * must stay byte-identical upstream (ADR-22), so the wiring lives here: the registry
 * registers `withAuthorMessages(VendoredSchema)` instead. No control consumes the prop;
 * the host reads it out of the compiled document and feeds the resolved string into the
 * field's error slot.
 */

/**
 * A resolved author message map: constraint key -> display string for the active
 * locale.
 *
 * The key set mirrors `@roonga/qcms-core`'s `ValidationMessageKey`, restated rather
 * than imported because `@roonga/qcms-ui` must not pull the kernel into the client
 * bundle. The golden corpus is what proves the two still agree.
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

/** The same node with its qcms-only `messages` prop removed. */
function withoutAuthorMessages(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const props = (node as { props?: unknown }).props;
  if (typeof props !== "object" || props === null || !("messages" in props)) return node;
  const rest: Record<string, unknown> = { ...(props as Record<string, unknown>) };
  delete rest.messages;
  return { ...(node as Record<string, unknown>), props: rest };
}

/**
 * A registry schema that accepts the ADR-32 `messages` prop on top of a vendored
 * control schema, validating both halves and reporting every issue from either.
 */
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
