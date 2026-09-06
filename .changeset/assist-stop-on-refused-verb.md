---
"create-qcms-app": patch
---

Stop an assist turn at the refused verb rather than at the step ceiling (issue #814).

The tool loop's only stop condition was the step ceiling, so a turn whose model reached for
a verb outside the allowlist recorded the refusal, yielded no proposal, and then carried on
asking. The SDK handed the model "no such tool", the model asked again, and the loop ran the
full `QCMS_AGENT_MAX_STEPS` budget to reach a conclusion that was settled at the first step.
The security control held throughout - nothing outside the four allowlisted verbs has ever
executed, and a refused turn has never produced a proposal - but a real provider was billed
for up to seven further round trips per refusal, and the panel showed the model's narration
once per step.

A second stop condition is now composed with the ceiling. It reads the tool loop's own
committed step record for a call outside the allowlist, using the same membership test the
tool set, the dispatch door and the event mapping use, so the recorded outcome is unchanged:
the refusal is still observed as the call streams, logged once, and emitted once with the
same code and the same sentence. Only the number of steps before them moves. The scaffolded
templates carry the change.
