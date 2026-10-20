---
"create-qcms-app": patch
---

Carry the polished assistant panel into the scaffolded admin and API shells.

The form builder's assistant panel now has a compact header with icon buttons (collapse,
start a new conversation) in place of the full-width collapse button, shows the
conversation as chat bubbles with the reply streaming in place behind a caret, renders the
reply as a small safe Markdown subset (no raw HTML, images or clickable links), shows a
plain-language step timeline whose steps read Done only on the API's new `tool-outcome`
event (Failed for an errored call, "Did not finish" for one a turn ended under), states the rationale once in the conversation, and keeps the
proposal's diff, validation and Accept and Discard together in one card. The assist route
answers with `no-transform` and `x-accel-buffering: no` so a proxy does not batch the
stream, and the system prompt (version 3) asks the model to say what it is about to do
before its first tool call.
