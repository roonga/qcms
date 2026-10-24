import { z } from "zod";

export type A2NodeInput = {
  type: string;
  props?: Record<string, unknown>;
  children?: A2NodeInput | A2NodeInput[] | string;
};

// Deliberately not composed with the per-component schemas, so it stays open to
// unknown component types at render time.
export const A2NodeSchema: z.ZodType<A2NodeInput> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.union([A2NodeSchema, z.array(A2NodeSchema), z.string()]).optional(),
  }),
);

export function parseNode(input: unknown): A2NodeInput {
  return A2NodeSchema.parse(input);
}

export function safeParseNode(input: unknown): ReturnType<typeof A2NodeSchema.safeParse> {
  return A2NodeSchema.safeParse(input);
}
