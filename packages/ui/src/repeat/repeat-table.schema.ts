import { z } from "zod";

import {
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_NODE_TYPE,
} from "./repeat-table-node.ts";

/**
 * Render-time only, so unlike `RepeatGroupSchema` nothing here validates a stored
 * shape. qcms-owned rather than the vendored `Table`, which renders `role="grid"` and
 * manages focus with script, which ADR-43 refuses.
 */

const RepeatColumnSchema = z
  .object({
    /** The bare id, also `data-qcms-column` on every cell. */
    questionId: z.string(),
    label: z.string(),
    /**
     * Drawn under the column header and clipped in the cells, because it is identical
     * in every cell of a column. Each input keeps its own `aria-describedby`, and the
     * card reflow shows the per-cell hint instead.
     */
    description: z.string().optional(),
    /** Gets figure-width digits and a `<tfoot>` total over {@link totalFields}. */
    numeric: z.boolean().optional(),
    /**
     * The names this render drew, not the roster: a per-instance rule can hide a
     * member, and totalling a cell the respondent cannot see would report a number the
     * page does not show.
     */
    totalFields: z.array(z.string()).optional(),
  })
  .strict();

export type RepeatColumn = z.infer<typeof RepeatColumnSchema>;

export const RepeatTableSchema = z.object({
  type: z.literal(REPEAT_TABLE_NODE_TYPE),
  props: z
    .object({
      groupId: z.string(),
      /** The group's own authored label. */
      caption: z.string(),
      /** Derived from the instance label. */
      rowHeader: z.string(),
      columns: z.array(RepeatColumnSchema),
      /** Visually hidden, because an empty `<th>` is what it may not be. */
      actionsLabel: z.string().optional(),
    })
    .strict(),
});

export type RepeatTableNode = z.infer<typeof RepeatTableSchema>;

export const RepeatRowSchema = z.object({
  type: z.literal(REPEAT_ROW_NODE_TYPE),
  props: z
    .object({
      groupId: z.string(),
      /** The row's `<th>` id, and so the focus landing. */
      instanceId: z.string(),
      /** Resolved; it is the row header and the focus target. */
      label: z.string(),
      /** One-based, renumbered after a removal. */
      ordinal: z.number(),
      /** Present when this instance may be removed. */
      removeLabel: z.string().optional(),
      opToken: z.string().optional(),
    })
    .strict(),
});

export type RepeatRowNode = z.infer<typeof RepeatRowSchema>;

export const RepeatCellSchema = z.object({
  type: z.literal(REPEAT_CELL_NODE_TYPE),
  props: z
    .object({
      /** Which column this cell belongs to, as `data-qcms-column`. */
      questionId: z.string(),
      /** Figure-width digits. */
      numeric: z.boolean().optional(),
    })
    .strict(),
});

export type RepeatCellNode = z.infer<typeof RepeatCellSchema>;
