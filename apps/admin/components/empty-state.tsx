import type { ReactNode } from "react";

export function EmptyState({
  heading,
  body,
  action,
  testId,
}: {
  readonly heading: string;
  readonly body?: string | undefined;
  readonly action?: ReactNode;
  readonly testId?: string | undefined;
}) {
  return (
    <div className="qcms-empty" {...(testId === undefined ? {} : { "data-testid": testId })}>
      <h2 className="qcms-empty__heading">{heading}</h2>
      {body !== undefined && <p className="qcms-empty__body">{body}</p>}
      {action !== undefined && <div className="qcms-empty__action">{action}</div>}
    </div>
  );
}
