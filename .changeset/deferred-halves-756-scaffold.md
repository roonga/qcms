---
"create-qcms-app": patch
---

Carry issue #756 into the scaffold templates: the four webhook URL rejection sentences
and their mapping in the admin catalog, the envelope reader that picks between them, and
the API rejection prose that no longer names an environment variable (ADR-24).

Template-only, because that is all this package ships. The reasoning for each change is
in the sibling changeset for the apps the templates are generated from.
