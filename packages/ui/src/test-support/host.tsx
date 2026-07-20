import { useState } from "react";

import { A2UIStepRenderer, type A2UIStepDocument } from "../A2UIStepRenderer.tsx";
import type { A2UIAnswerValue, A2UIValues } from "../field-context.tsx";

/** Records the latest emitted canonical value per questionId. */
export function useChanges() {
  const record = new Map<string, A2UIAnswerValue | undefined>();
  // Arrow-function properties (not methods) so passing `changes.onChange` as a
  // prop does not trip the unbound-method lint.
  const onChange = (name: string, value: A2UIAnswerValue | undefined): void => {
    record.set(name, value);
  };
  const latest = (name: string): A2UIAnswerValue | undefined => record.get(name);
  return { record, onChange, latest };
}

/**
 * A genuinely-controlled host: owns `values` in state and feeds them back into
 * the renderer on every change, so the controls reflect their controlled value
 * (what a portal/admin parent does). `onChange` also forwards to a spy.
 */
export function ControlledHost({
  document,
  onChange,
}: {
  readonly document: A2UIStepDocument;
  readonly onChange?: (name: string, value: A2UIAnswerValue | undefined) => void;
}) {
  const [values, setValues] = useState<A2UIValues>({});
  return (
    <A2UIStepRenderer
      document={document}
      values={values}
      onChange={(name, value) => {
        setValues((current) => ({ ...current, [name]: value }));
        onChange?.(name, value);
      }}
    />
  );
}
