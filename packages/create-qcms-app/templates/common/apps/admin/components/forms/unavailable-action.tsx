import { Button } from "@/components/kit";

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
  /** Also names the reason, which the control is described by. */
  readonly testId: string;
  readonly variant?: "primary" | "secondary";
}) {
  const reasonId = `${testId}-reason`;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1" data-testid={testId}>
      <Button variant={variant} size="md" isDisabled aria-describedby={reasonId}>
        {label}
      </Button>
      <span id={reasonId} className="text-sm text-(--color-text-muted)">
        {reason}
      </span>
    </span>
  );
}
