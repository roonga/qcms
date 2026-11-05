import { EntityId } from "@/components/entity-id";
import { queueFormName, type QueueFormNames } from "@/lib/ops/queue-forms";

/** A global queue row's form: its name when the caller may read the form, else its id. */
export function QueueFormCell({
  names,
  formId,
}: {
  readonly names: QueueFormNames;
  readonly formId: string;
}) {
  const name = queueFormName(names, formId);
  if (name === undefined) return <EntityId kind="form" value={formId} />;
  return (
    <span data-testid="qcms-queue-form" data-form-id={formId}>
      {name}
    </span>
  );
}
