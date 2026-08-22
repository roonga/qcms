import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the secure-links screen (issue 559, the reference screen; issue 561
 * rolled it across the rest).
 *
 * Issue 559 built the rail once and wired it here rather than on the builder, so the other
 * screens would get a reviewed component instead of seven copies of an unreviewed one. The
 * builder is still the one form-scoped screen without a rail, and the reason is recorded
 * with the exception that keeps it that way (`lib/rail-routes.test.ts`).
 */
export default function FormLinksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "links" }} />;
}
