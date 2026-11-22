Publish an existing version to one environment, including an earlier one, which makes
that earlier version live again. Nothing is frozen. Production accepts only a version
already live in a non-production environment,
where one exists. The workflow revision, the destination's current state and second
approval are all rechecked at confirmation, so a stale review is refused and writes
nothing, exactly as on the screen.
