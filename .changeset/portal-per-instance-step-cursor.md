---
"create-qcms-app": patch
---

The scaffolded portal and admin carry task 076's per-instance step presentation.

The ADR-28 cursor indexes step **views** rather than steps, so a repeating group whose presentation is `perInstanceStep` is one page per live instance: the progress indicator counts views and names the instance, Back and Continue move one view, and Submit appears on the last. Without scripting there is no Back by design, so the server serves the first view whose instance is incomplete and the group's Add control sits on the last view.

The template's step views, its flow announcer, its page chrome and its API view projection move with it. A form with no repeating group produces the same page list, the same numbers and the same navigation it produced before.
