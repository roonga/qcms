---
"create-qcms-app": patch
---

The scaffolded appearance panel survives a reopen that beats its own close.

The panel closes itself when focus leaves it, measured on the next tick because a press
inside reports focus passing through nothing. Closing moves focus back to the trigger, so
that deferred check sees focus outside the panel and closes it again - and on a loaded
machine the tick can land after the operator has already pressed the trigger a second
time, so the panel opened and then shut on its own. The check now ignores a panel that is
no longer in the document, which is exactly the case where the blur it is reacting to was
the close.
