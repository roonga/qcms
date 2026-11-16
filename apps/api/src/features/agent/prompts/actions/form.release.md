Publish an existing version to one environment, including an earlier one (rollback).
Nothing is frozen. Prod accepts only a version already live in a non-prod environment,
where one exists. The workflow revision, the destination's release state and second
approval are all rechecked at confirmation, so a stale review is refused and writes
nothing, exactly as on the screen.
