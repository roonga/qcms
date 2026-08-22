# Gate: the form-subtree rail across the remaining screens (issue 561)

Approve that the §7 rail reads correctly on the six screens that gained it, and that the builder was right to be left without one.

| Frame | The clause it claims |
| --- | --- |
| `builder-1280.png` | The escalation: the builder is the one form-scoped screen still without a rail, and keeps its section strip. |
| `preview-390.png` | §7 collapsed: below `--bp-sidebar` the rail is a disclosure. |
| `preview-1280.png` | §7 with `plan/admin-ux-audit.md` §3.4: the rail beside a respondent-facing render that keeps its narrow measure. |
| `versions-390.png` | §7 collapsed on the history screen. |
| `versions-1023.png` | §1 / §7: one pixel below `--bp-sidebar`, still a disclosure and not a column. |
| `versions-1024.png` | §1 / §7: at `--bp-sidebar`, the 240px column, both groups, one divider. |
| `versions-1280.png` | §7 with §3.2: the rail's children are the form's STEPS, beside a column listing versions. |
| `version-detail-390.png` | §7 collapsed on one stored version. |
| `version-detail-1280.png` | §7: a detail route marks the section it lives under (History), and keeps §3.4's narrow measure. |
| `responses-390.png` | §7 collapsed on the responses list. |
| `responses-1280.png` | §7 with §5.4: the children are the form's steps, not the responses in the column. |
| `response-detail-390.png` | §7 collapsed on one collected response. |
| `response-detail-1280.png` | §7 with §3.7: the rail carries no action, so the erasure door stays in the main column. |
| `webhooks-390.png` | §7 collapsed on the per-form webhooks screen. |
| `webhooks-1280.png` | §7 with §6: the widest screen in the subtree, with the 240px track taken off the shell. |

The secure-links screen is unchanged by this issue and keeps issue 559's frames in `docs/gates/pr-559/`.

Shot by `apps/admin/e2e/gate-561.pw.ts`, one frame per `test`, against the seeded insurance form plus one submitted response.
