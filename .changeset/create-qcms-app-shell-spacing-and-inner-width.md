---
"create-qcms-app": patch
---

Carry the admin shell's section-padding token and its inner width layer into the scaffold
(issues #675 and #668).

The templates are generated from `apps/admin`, so this is the scaffolded half of the same
change: the topbar row and the content column both spend `--admin-section-pad`, the three
screens whose POC draws an element inside the column take their POC's outer cap and let the
element carry the inner one, and the draft preview and the stored version render inside the
drawn respondent frame. An adopter scaffolding today gets the shell the drawings specify
rather than the one that was 4px out and 48px narrow.
