import { z } from "zod";

/**
 * The qcms-side node-prop extension for author-supplied validation messages
 * (task 048, ADR-32).
 *
 * ADR-32 puts the author's per-constraint wording on the control node as an
 * optional `messages` prop, which collides with a property of the vendored
 * schemas: every `@a2ra/core` control props object is `.strict()`, and
 * `A2Renderer` validates each node against its registry schema before rendering
 * it (an unknown prop is a thrown error, not an ignored key). The vendored
 * schemas must stay byte-identical upstream (ADR-22, clean `a2ra diff`), so the
 * qcms wiring lives here instead, exactly as the controlled adapters do: the
 * registry registers `withAuthorMessages(VendoredSchema)` for each control the
 * compiler can emit messages on.
 *
 * What that wrapper does is validate the node in two halves - the `messages`
 * prop against {@link AuthorMessagesSchema}, and the node *without* it against
 * the vendored schema, which therefore still sees exactly the upstream shape.
 * The prop is never consumed by a control: the host reads it out of the compiled
 * document (the portal's `questionMessages`) and feeds the resolved string into
 * the field's error slot. The vendored components destructure their props
 * explicitly, so the extra key they receive is inert.
 */

/**
 * A resolved author message map: constraint key -> display string for the
 * active locale (the compiler resolved the `LocalizedText` at publish time).
 *
 * The key set mirrors `@roonga/qcms-core`'s `ValidationMessageKey`. It is restated
 * rather than imported because `@roonga/qcms-ui` is a browser package that must not
 * pull the kernel into the client bundle; `packages/a2ui-compiler` is what pairs
 * the two, and the golden corpus rendered by `conformance.test.tsx` is what
 * proves they still agree.
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
    // Re-issued as `custom` with the failing schema's own message and path: the
    // point is a readable "Invalid props for X" from `A2Renderer`, and zod's
    // per-code issue types are not re-addable verbatim across schemas.
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
