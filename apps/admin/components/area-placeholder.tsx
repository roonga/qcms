import { Alert } from "@/components/kit";

/**
 * The stand-in for an area screen tasks 032-035 will build (task 031).
 *
 * The shell has to be navigable and reviewable now - the screenshot gate is on the
 * shell, and every nav item has to lead somewhere - but 031's scope stops at the
 * shell and auth. So each area renders its heading and one `info` alert naming the
 * task that fills it. That is deliberately not a blank page: an empty area during a
 * design review reads as a bug, and a reviewer should not have to check the plan to
 * know whether it is one.
 *
 * These are the only files 032-035 are expected to delete outright.
 */
export function AreaPlaceholder({
  title,
  pending,
}: {
  readonly title: string;
  readonly pending: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-(--color-text)">{title}</h1>
      <Alert variant="info">{pending}</Alert>
    </div>
  );
}
