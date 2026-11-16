Propose the complete draft FormDefinition for the form this builder screen is about.
Returns the advisory validation issues that would block a publish, and the warnings that
would not. It saves nothing: follow it with the apply-draft action, which is the only
thing that keeps it. It exists on the form builder alone; elsewhere, save a draft with a
form.saveDraft step instead.
