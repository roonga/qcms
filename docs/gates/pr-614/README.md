# Gate: version detail keeps its header when the version read fails (issue 614)

## What to approve

`plan/admin-design-contracts.md` §3, "error states are not empty states", as issue 521
derived it and `apps/admin/app/(shell)/form-read-states.test.tsx` asserts it at four
sites: "and nothing else" means nothing that CLAIMS anything about the failed read, and
chrome that stays true is not such a claim. Applied to one branch of one route.

| Read that failed | Suppressed | Kept |
|---|---|---|
| `getFormVersion` (the VERSION read) | the version body (`VersionView`), replaced by the error alert | breadcrumb, the `h1` naming the version, the identity line, the back link, the rail |
| `getForm` (the FORM read) | everything but the alert | nothing, deliberately |

**The second row is not a defect and is not being asked about.** `FormPageHeader` is built
from the form's slug and its open/closed status, and both arrive on the read that failed
there, so the alternative is a header captioned with a slug the app does not have. The
first row is different only because by the time it is reached the form read has already
succeeded: the slug and status are in hand, and the version number comes from the route
params rather than from the read. Everything the header needs survives, and before this
change it was discarded anyway.

The shape is not new. `app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx` has
shipped it since issue 510: keep the chrome, replace the body.

## Why there are no screenshots

**Neither of this route's failed-read states is reachable from the capture harness**, and
that is a property of the states rather than a gap in the spec. Both were checked rather
than assumed.

- **The FORM read failing is not reachable by URL at all.** The route 404s on
  `FORM_NOT_FOUND` and `INVALID_FORM_ID`, which are the only failures a chosen form id can
  produce. There is no form id that makes `getForm` fail with anything else.
- **The VERSION read failing non-404 requires making the API fault.** Measured against the
  real handler and a Testcontainers Postgres rather than reasoned about, because the whole
  judgement rests on it:

  | `GET /admin/forms/{id}/versions/{v}` | Status | Code |
  |---|---|---|
  | `1` | 404 | `VERSION_NOT_FOUND` |
  | `2000000000` | 404 | `VERSION_NOT_FOUND` |
  | `2147483648` | **500** | `internal` |

  Every in-range version answers 404, which the route turns into `notFound()`. The only
  path to a non-404 is a version segment outside `int4`, which the route's own guard
  accepts (it is a positive integer) and which then reaches Postgres as an out-of-range
  comparison against an `integer` column. That is a 500, an error-level "unhandled error"
  in the API log, and a hard failure of the suite's own server-error gate, which never
  allowlists one (`apps/portal/e2e/support/gates.ts`). Photographing a screen by provoking
  a server fault the suite exists to catch is not a capture, and weakening that gate for a
  screenshot is not a trade this change is entitled to make. (The 500 itself is a
  different component and a different decision, so it is filed as issue #645 rather than
  fixed here. Closing that one makes this state unreachable from a browser outright, which
  is a strictly better place to be than the one this note describes.)

These reads run in the Next **server** process, so `page.route()` never sees the request
either; `playwright.config.ts` records the underlying constraint. That is the same wall
issues 543, 544 and 572 hit on the same class of change, and `docs/gates/pr-572/` is the
same shape as this directory: no frames, a stated reason, and the static-render layer
standing in for them.

Issue 553's forced-failure capture (`apps/admin/e2e/gate-screenshots-pr-521.pw.ts`) was
looked at before concluding this, because it is the nearest precedent. It photographs a
state reached by an **invalid query string** - filters the screen refuses - which needs no
server fault at all. This route has no analogous input: its only inputs are the form id and
the version segment, and every invalid value of either one 404s by design.

## The files

- `red-first.txt` - the new tests run against the **unfixed** route (`git stash` of the
  page, test file kept). **1 test failed, 7 passed**, and the one failure carries seven
  soft assertions, which is the shape of the defect: not one missing element but the whole
  header discarded. The `Received` line is the entire page, verbatim:

  ```
  <div data-testid="qcms-alert" data-variant="error">forms.history.failed(upstream said 503)</div>
  ```

  The seven are the breadcrumb, `id="qcms-version-heading"`, the `h1` text
  `forms.history.versionHeading(7)`, the back link's copy, its `href`, and the identity
  line's two halves.

  The 7 that pass pre-fix are the controls that matter here, and they are the reason this
  is a one-branch change rather than two: the **form**-read branch already rendered the
  bare alert and still does, both 404 paths already 404ed and still do, the success path
  was already whole, and the rail already survived a failed version read and already
  degraded to nothing on a failed form read.
- `green-after.txt` - the same file after the fix, verbose, **8 passed**.

Runner output in both is filtered to repo-root-relative paths.

## What this evidence does not cover

The rail's two answers are asserted through `FormRailSlot`, which is where the reads and
the degrade policy live. The three-line slot route above it, which only chooses that the
current row is Versions, is not rendered here: it returns an async component, and
`renderToStaticMarkup` is synchronous. The claim that this URL's rail marks Versions is
covered where it was made, in `apps/admin/e2e/rail-screens.pw.ts:82`.
