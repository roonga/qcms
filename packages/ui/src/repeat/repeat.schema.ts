import { z } from "zod";

import { REPEAT_GROUP_NODE_TYPE, REPEAT_INSTANCE_NODE_TYPE } from "./repeat-node.ts";

/**
 * One schema covers both the stored shape and the expanded one, deliberately: the same
 * component renders both, and a stored document that reaches the renderer unexpanded,
 * as a version view does, has to validate too or `strict` mode refuses the page.
 */

const PRESENTATIONS = ["stacked", "perInstanceStep", "table"] as const;
const COUNT_SOURCES = ["fixed", "fromAnswer", "open"] as const;

export const RepeatGroupSchema = z.object({
  type: z.literal(REPEAT_GROUP_NODE_TYPE),
  props: z
    .object({
      /** What the roster, the field names and the `__qop` values key on. */
      groupId: z.string(),
      /** The collection's own authored name. */
      label: z.string(),
      /** `{n}` intact, because the ordinal is live state. */
      instanceLabel: z.string(),
      presentation: z.enum(PRESENTATIONS),
      countSource: z.enum(COUNT_SOURCES),
      min: z.number(),
      /** Absent only on a bounded source that omitted it, which publish refuses. */
      max: z.number().optional(),
      /** `open` only, resolved at compile time. */
      addLabel: z.string().optional(),
      /** `open` only; the placeholder is filled per instance. */
      removeLabel: z.string().optional(),
      // Added at render time by the expansion; never stored.
      instanceCount: z.number().optional(),
      /** False at `max`, or on a count source whose size is not the respondent's. */
      canAdd: z.boolean().optional(),
      opToken: z.string().optional(),
      headingAs: z.enum(["h1", "h2", "h3", "h4"]).optional(),
    })
    .strict(),
});

export type RepeatGroupNode = z.infer<typeof RepeatGroupSchema>;

/** A render-time node the compiler never emits, so no stored document carries one. */
export const RepeatInstanceSchema = z.object({
  type: z.literal(REPEAT_INSTANCE_NODE_TYPE),
  props: z
    .object({
      groupId: z.string(),
      /** Never a visible label: it is in names, ids and anchors. */
      instanceId: z.string(),
      /** Resolved; it is the legend, the heading and the focus target. */
      label: z.string(),
      /** One-based, renumbered after a removal. */
      ordinal: z.number(),
      headingAs: z.enum(["h1", "h2", "h3", "h4"]),
      /** Present when this instance may be removed. */
      removeLabel: z.string().optional(),
      opToken: z.string().optional(),
    })
    .strict(),
});

export type RepeatInstanceNode = z.infer<typeof RepeatInstanceSchema>;
