---
"create-qcms-app": minor
---

Scaffold both CSV export shapes for repeating groups (task 075, ruling Q17).

The templates are generated from `apps/api` and `apps/admin`, so this is the scaffolded half
of the same change. A scaffolded deployment's export route takes a `shape` parameter beside
the `version` CSV already requires: `long` (the default) keeps `responses.csv` to the
questions outside every repeating group and puts each group's instances in a file of its own,
zipped when the version has a group, while `wide` folds the members back in as indexed
columns. The scaffolded admin's export dialog offers the choice and carries the consequence an
operator needs before automating a wide export - a wide header is the version's declared
maximum, so it changes when that maximum changes - and names the download from the content
type the API answered with, so a zip is offered as a zip.

Nothing an adopter configures changes, and a form with no repeating group exports exactly the
single file it exported before, in either shape.
