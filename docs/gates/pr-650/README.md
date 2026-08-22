# Gate: the question detail screen's rail (issue 650)

Approve the rail on `/questions/{questionId}` against the screen's own design,
`plan/admin-shell-poc/question-editor-poc.html`: one group carrying this question's versions
newest first, each row naming the version, its status and when it was published, with the
selected row marked; a "Versions" label row and a digest above them; the lifecycle actions
pinned above the list rather than below it; a 240px column at and above `--bp-sidebar` and a
disclosure below it whose shut summary names the question and the selected version.

| Frame | Viewport | Clause it claims |
| --- | --- | --- |
| `detail-390.png` | 390 | Below `--bp-sidebar` the rail is a disclosure, shown open above the column |
| `detail-390-shut.png` | 390 | Shut, the summary is the question id and the selected version and nothing else |
| `detail-1023.png` | 1023 | One pixel below the boundary, still a disclosure |
| `detail-1024.png` | 1024 | At the boundary: the 240px track, the digest, the pinned actions, the version list |
| `detail-1280.png` | 1280 | The newest version selected, its Publish action, the version list beside the editor |
| `detail-1280-published.png` | 1280 | A published version selected: the frozen editor, and Deprecate in place of Publish |

Captured by `apps/admin/e2e/gate-650.pw.ts`, one frame per test, against a question built
through the app (`apps/admin/e2e/support/question-rail.ts`) so that its three versions carry
three different statuses.
