/**
 * The stand-in for an area screen tasks 032-035 will build (task 031).
 *
 * The shell has to be navigable and reviewable now - the screenshot gate is on the shell,
 * and every nav item has to lead somewhere - but 031's scope stops at the shell and auth. So
 * each area renders its heading and one line naming the task that fills it. That is
 * deliberately not a blank page: an empty area during a design review reads as a bug, and a
 * reviewer should not have to check the plan to know whether it is one.
 *
 * The line is **plain prose, not an `Alert`**, and that distinction is why this component
 * exists rather than each page calling `Alert` directly. The vendored `Alert` always renders
 * `role="alert"`, a live region, so using it here would make a screen reader announce "the
 * question library lands in task 032" on every navigation into the area, and would compete
 * with a genuine message when one appeared. `Alert` is for something that just happened; a
 * permanent note about the roadmap is not that.
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
      <p className="rounded border border-dashed border-(--color-border-strong) bg-(--color-background-muted) px-4 py-3 text-sm text-(--color-text-muted)">
        {pending}
      </p>
    </div>
  );
}
