import { useState } from "react";

import { A2UIStepRenderer, type A2UIStepDocument } from "../A2UIStepRenderer.tsx";
import type { A2UIAnswerValue, A2UIValues } from "../field-context.tsx";

export function useChanges() {
  const record = new Map<string, A2UIAnswerValue | undefined>();
  // Arrow-function properties rather than methods, so passing `changes.onChange` as a
  // prop does not trip the unbound-method lint.
  const onChange = (name: string, value: A2UIAnswerValue | undefined): void => {
    record.set(name, value);
  };
  const latest = (name: string): A2UIAnswerValue | undefined => record.get(name);
  return { record, onChange, latest };
}

// Owns `values` in state and feeds them back, as a real parent does, so the controls
// are genuinely controlled rather than merely spied on.
export function ControlledHost({
  document,
  onChange,
  onBlur,
}: {
  readonly document: A2UIStepDocument;
  readonly onChange?: (name: string, value: A2UIAnswerValue | undefined) => void;
  readonly onBlur?: (name: string) => void;
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
      {...(onBlur ? { onBlur } : {})}
    />
  );
}
