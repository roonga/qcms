/**
 * An act the caller cannot take here, drawn disabled with the reason beside it. The route
 * behind it still answers for itself: hiding or disabling a control authorises nothing.
 */
export function UnavailableAction({
  label,
  reason,
  testId,
  variant = "primary",
}: {
  readonly label: string;
  readonly reason: string;
  /** Also names the reason, `<testId>-reason`, which the control is described by. */
  readonly testId: string;
  readonly variant?: "primary" | "secondary";
}) {
  const reasonId = `${testId}-reason`;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1" data-testid={testId}>
      {/* A native control: the kit Button does not forward aria-describedby. */}
      <button
        type="button"
        disabled
        aria-describedby={reasonId}
        className={`qcms-button-link ${variant === "secondary" ? "qcms-button-link--secondary " : ""}cursor-not-allowed opacity-50`}
      >
        {label}
      </button>
      <span id={reasonId} className="text-sm text-(--color-text-muted)" data-testid={reasonId}>
        {reason}
      </span>
    </span>
  );
}
