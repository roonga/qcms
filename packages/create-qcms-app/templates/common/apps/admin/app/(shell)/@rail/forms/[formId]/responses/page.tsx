import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the responses list (issue 561).
 *
 * The children group is the form's steps. A response is not a child of the form in the
 * sense §7 uses the word - the contract names the children as the steps, and the audit's
 * §5.4 objection to a rail that repeats the page's own body applies to a rail listing
 * responses beside a table of responses just as it does on the history screen.
 */
export default function FormResponsesRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "responses" }} />;
}
