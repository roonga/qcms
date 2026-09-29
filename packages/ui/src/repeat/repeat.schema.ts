import { z } from "zod";

import { REPEAT_GROUP_NODE_TYPE, REPEAT_INSTANCE_NODE_TYPE } from "./repeat-node.ts";

/**
 * Schemas for the two repeat node types (task 073, ADR-42, ADR-43).
 *
 * `RepeatGroup` is a **qcms-specific node type**, not an `@a2ra/core` registry
 * component, on the `Honeypot` precedent: nothing upstream describes a container
 * whose children are cloned per live instance, and the vendored component props
 * objects are `.strict()` (ADR-22, the vendored bytes never move).
 *
 * **One schema covers both the stored shape and the expanded one**, and that is
 * deliberate rather than lax. The compiler emits the template - `groupId`, `label`,
 * `instanceLabel`, `presentation`, `countSource`, `min`, and `max`, `addLabel` and
 * `removeLabel` where they apply - and `expandRepeatGroups` adds the render-time
 * facts (`instanceCount`, `canAdd`, `opToken`). Both shapes are rendered by the same
 * component through the same registry, and a stored document that reaches the
 * renderer unexpanded (the admin's version view draws a stored document verbatim)
 * has to validate too, or the registry's `strict` mode refuses the page rather than
 * showing an empty group.
 */

const PRESENTATIONS = ["stacked", "perInstanceStep", "table"] as const;
const COUNT_SOURCES = ["fixed", "fromAnswer", "open"] as const;

export const RepeatGroupSchema = z.object({
  type: z.literal(REPEAT_GROUP_NODE_TYPE),
  props: z
    .object({
      /** The group the roster, the field names and the `__qop` values key on. */
      groupId: z.string(),
      /** The collection's own authored name ("Vehicles"). */
      label: z.string(),
      /** The instance-label template, `{n}` intact: the ordinal is live state. */
      instanceLabel: z.string(),
      presentation: z.enum(PRESENTATIONS),
      countSource: z.enum(COUNT_SOURCES),
      min: z.number(),
      /** Absent only on a bounded source that omitted it, which publish refuses. */
      max: z.number().optional(),
      /** `open` only: "Add Vehicle", resolved at compile time. */
      addLabel: z.string().optional(),
      /** `open` only: "Remove {label}", the placeholder filled per instance. */
      removeLabel: z.string().optional(),
      // --- Added by `expandRepeatGroups` at render time; never stored. ---
      /** How many live instances this render drew. */
      instanceCount: z.number().optional(),
      /** False at `max`, or on a count source whose size is not the respondent's. */
      canAdd: z.boolean().optional(),
      /** The one-time operation token this render minted into its buttons. */
      opToken: z.string().optional(),
      /** The heading level the group's own label renders at. */
      headingAs: z.enum(["h1", "h2", "h3", "h4"]).optional(),
    })
    .strict(),
});

export type RepeatGroupNode = z.infer<typeof RepeatGroupSchema>;

/**
 * One live instance: a render-time node the compiler never emits, so a stored
 * document can never carry one.
 */
export const RepeatInstanceSchema = z.object({
  type: z.literal(REPEAT_INSTANCE_NODE_TYPE),
  props: z
    .object({
      groupId: z.string(),
      /** The opaque `ins_` id. Never a visible label; it is in names, ids and anchors. */
      instanceId: z.string(),
      /** The resolved instance label ("Vehicle 2"): legend, heading and focus target. */
      label: z.string(),
      /** The live one-based ordinal, renumbered after a removal. */
      ordinal: z.number(),
      /** The heading level the instance label renders at inside its `<legend>`. */
      headingAs: z.enum(["h1", "h2", "h3", "h4"]),
      /** Present when this instance may be removed: the resolved control name. */
      removeLabel: z.string().optional(),
      /** The one-time operation token, for the Remove button's `__qop` value. */
      opToken: z.string().optional(),
    })
    .strict(),
});

export type RepeatInstanceNode = z.infer<typeof RepeatInstanceSchema>;
