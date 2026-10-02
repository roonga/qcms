import { z } from "zod";

import {
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_NODE_TYPE,
} from "./repeat-table-node.ts";

/**
 * Schemas for the three table-presentation node types (task 077, ADR-43).
 *
 * All three are **render-time only**: {@link expandRepeatTable} produces them from a
 * stored `RepeatGroup` template and the live roster, so a stored document can never
 * carry one and nothing here has to validate a stored shape. That is the one way
 * these differ from `RepeatGroupSchema`, which covers both shapes because the admin's
 * version view draws a stored document verbatim.
 *
 * They are qcms-owned node types rather than `@a2ra/core` registry components, on the
 * `Honeypot` and `RepeatInstance` precedent: the vendored `Table` is a react-aria
 * `Table`, which renders `role="grid"` and manages focus with script, and ADR-43
 * refuses that outright. What the vendored component contributes is its style map, not
 * its markup.
 */

/** One column of the table: a member question, as a header cell and a cell per row. */
const RepeatColumnSchema = z
  .object({
    /** The member question's bare id. Also `data-qcms-column` on every cell. */
    questionId: z.string(),
    /** The column header's text: the member question's own compiled label. */
    label: z.string(),
    /**
     * The member question's own help text, drawn under the column header.
     *
     * It is on the HEADER and clipped in the cells, because it is identical in every
     * cell of a column: a three-row table would otherwise repeat "As printed on the
     * plate, without spaces" three times. Each input keeps its own
     * `aria-describedby`, so nothing leaves the accessibility tree, and at the card
     * reflow the header is gone and the per-cell hint becomes visible instead.
     */
    description: z.string().optional(),
    /**
     * A `number` column, which gets figure-width digits and a `<tfoot>` total.
     * Present together with {@link totalFields}, which is what the total sums.
     */
    numeric: z.boolean().optional(),
    /**
     * The qualified field names this render DREW for the column
     * (`ins_7k2/q_as_value`), which is what the total is summed over.
     *
     * The drawn set rather than the roster, because a per-instance rule can hide a
     * member in one instance and not in another: totalling a cell the respondent
     * cannot see would report a number the page does not show.
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
      /** The `<caption>`: the group's own authored label ("Assets"). */
      caption: z.string(),
      /** The row-header column's own name, from the instance label ("Asset"). */
      rowHeader: z.string(),
      columns: z.array(RepeatColumnSchema),
      /**
       * The actions column's header text, present exactly when the rows carry a
       * Remove control. Visually hidden; an empty `<th>` is what it may not be.
       */
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
      /** The opaque `ins_` id: the row's `<th>` id, and so the focus landing. */
      instanceId: z.string(),
      /** The resolved instance label ("Asset 3"): row header and focus target. */
      label: z.string(),
      /** The live one-based ordinal, renumbered after a removal. */
      ordinal: z.number(),
      /** Present when this instance may be removed: the resolved control name. */
      removeLabel: z.string().optional(),
      /** The one-time operation token, for the Remove button's `__qop` value. */
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
      /** A `number` column's cell: figure-width digits. */
      numeric: z.boolean().optional(),
    })
    .strict(),
});

export type RepeatCellNode = z.infer<typeof RepeatCellSchema>;
