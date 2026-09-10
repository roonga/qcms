import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Card, Select, TextField } from "@/components/kit";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { FORM_SORTS } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import { pageMetadata } from "@/lib/page-title";
import { optionalProp } from "@/lib/questions/errors";
import { listForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { FormsTable } from "./forms-table";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.title"));
}

/**
 * The form library (task 033; screen contract `admin-form-builder.md`, the screen its
 * breadcrumb roots at).
 *
 * A server component that proxies one call and renders the answer, exactly as 032's
 * question library does.
 *
 * ## Searching, filtering and sorting, and where they happen (issue 686)
 *
 * This screen used to say it had none, and gave a reason that was half right: a second
 * ordering in this app would be a decision the BFF has no authority to make (R2). True,
 * and it stopped one step short of the answer the sibling screen already ships. The
 * question library is filtered too and breaks no rule doing it, because every filter it
 * offers is the **API's**: they live in the URL, they travel on the query string, and
 * `GET /admin/questions` applies them. `GET /admin/forms` simply had no such parameters,
 * so the blocker was an absent route capability rather than R2. It has them now
 * (`status`, `search` over the slug and the form title, and `sort`), and this screen
 * sends them the same way.
 *
 * Three consequences worth stating, because each is a property a reader can check:
 *
 * - **The state is the URL.** A filtered library is a link an author can send and a page
 *   that survives a reload, and nothing about the current view lives in component state.
 * - **A native GET form.** The toolbar is `<form method="get">` over the vendored
 *   controls, which serialize into hidden native inputs, so Apply works with JavaScript
 *   off. Nothing here is an event handler.
 * - **One request either way.** Filters change the query string, never the number of
 *   round trips; `lib/server/request-reads.test.ts` counts them.
 *
 * `plan/admin-shell-poc/library-lists-poc.html` draws all three controls on this screen
 * and says in its own words that they are new because the shipped screen has none. It
 * also draws a pager, which is not built: `GET /admin/forms` takes no page parameter, the
 * POC records that as an upstream gap on both library screens, and inventing pagination
 * on the way past would be a second decision riding on this one.
 *
 * ## Creating is not on this screen (issue 685)
 *
 * It was, as a card between the heading and the table, and
 * `plan/admin-shell-poc/library-lists-poc.html` names that card as the thing to change:
 * it picks a separate creation route for BOTH library screens, on the grounds that
 * minting an id is a one-way door (R6) that deserves a screen rather than a slot beside a
 * table of everything already made, and that a card an author pays for on every visit
 * pushes the list they came to read below the fold. So this screen links to `/forms/new`
 * and lists, which is now the same shape `/questions` has.
 *
 * ## What each row says, and why the two state columns are separate
 *
 * A form has two independent states and collapsing them loses the distinction that matters
 * most to an author: **draft** is "there is unpublished work in the builder" and
 * **published** is "respondents are seeing version N". A form can have both (the usual
 * mid-edit case), either, or neither, so they get a column each rather than one
 * merged status word that would have to invent a precedence between them.
 *
 * `status` is the third and separate thing: whether the form accepts responses at all
 * (open/closed), which 034's publish flow and the link screens act on, and it is what the
 * Status filter above narrows on.
 */

export default async function FormsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { status, sort, search, isFiltered } = readFormListFilters(await searchParams);

  const result = await listForms(session, {
    ...optionalProp("status", status),
    search,
    sort,
  });

  const isEmpty = result.ok && result.data.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("forms.title")}</h1>
          <p className="text-sm text-(--color-text-muted)">{t("forms.intro")}</p>
        </div>
        {/* The header's creating action, rendered except in the one state where the
            empty panel below carries it instead: an unfiltered library with nothing in
            it. Same rule and same reason as `/questions`, whose header this is copied
            from rather than re-derived: two controls with the same accessible name on
            one screen are ambiguous to anyone navigating by name, and
            `plan/admin-design-contracts.md` §3 asks the empty state to OFFER the
            creating action rather than to sit beside a copy of it. A filtered-empty
            library is not that state: the library is not empty, the panel's CTA is
            "Clear filters", and this link stays. */}
        {!(isEmpty && !isFiltered) && (
          <Link href="/forms/new" className="qcms-button-link">
            {t("forms.new")}
          </Link>
        )}
      </div>

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          {/* A GET form, so a filtered library is a URL: shareable, bookmarkable, and
              still operable with JavaScript off even though the builder is not. */}
          <form method="get" className="qcms-filters">
            <fieldset className="qcms-fieldset qcms-fieldset--flat">
              <legend className="qcms-visually-hidden">{t("forms.filter.legend")}</legend>
              <div className="qcms-filters__row">
                <TextField
                  name="q"
                  label={t("forms.filter.search")}
                  description={t("forms.filter.searchHint")}
                  defaultValue={search}
                  // The API caps the term at the same number and answers 400 past it
                  // (issues #686, #862); this stops the author there instead.
                  maxLength={LIBRARY_SEARCH_MAX_LENGTH}
                />
                <Select
                  name="status"
                  label={t("forms.filter.status")}
                  defaultValue={status ?? ""}
                  placeholder={t("forms.filter.statusAll")}
                  items={[
                    { label: t("forms.filter.statusAll"), value: "" },
                    { label: t("forms.status.open"), value: "open" },
                    { label: t("forms.status.closed"), value: "closed" },
                  ]}
                />
                {/* Sort has no "any" option, because there is no such order: the list
                    comes back in some sequence whatever the URL says, so the control
                    always shows the one in force. `sort` is resolved rather than raw
                    for that reason - an unreadable key in the URL shows as the default
                    here instead of leaving the control blank. */}
                <Select
                  name="sort"
                  label={t("forms.filter.sort")}
                  defaultValue={sort}
                  items={FORM_SORTS.map((value) => ({
                    label: t(`forms.filter.sort.${value}`),
                    value,
                  }))}
                />
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="secondary" size="md">
                    {t("forms.filter.apply")}
                  </Button>
                  {/* The filter's own reset, rendered except when the filtered-empty
                      panel below is carrying it as its CTA
                      (`plan/admin-design-contracts.md` §3). Same rule as the header's
                      creating action above: the empty panel OFFERS the way out rather
                      than sitting beside a second control with the same accessible
                      name, which is ambiguous to anyone navigating by name. */}
                  {isFiltered && !isEmpty && (
                    <Link href="/forms" className="qcms-text-link">
                      {t("forms.filter.clear")}
                    </Link>
                  )}
                </div>
              </div>
            </fieldset>
          </form>
        </Card>
      </div>

      {!result.ok && (
        <Alert variant="error">{t("forms.error.listFailed", { message: result.message })}</Alert>
      )}

      {/* `plan/admin-design-contracts.md` §3's panel, in both of its variants. The
          filtered one keeps the panel and the clear-filters action, swaps the heading to
          this screen's own "no matches" line, and drops the explanatory sentence: an
          author who has just typed a filter is not asking what the library is for. The
          unfiltered one keeps the sentence and offers the creating action, which is the
          same destination as the header link - an empty screen is where a first-time
          operator looks, not the corner of the header. */}
      {isEmpty &&
        (isFiltered ? (
          <EmptyState
            heading={t("forms.empty.filtered")}
            testId="qcms-forms-empty"
            action={
              <Link href="/forms" className="qcms-button-link">
                {t("forms.filter.clear")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            heading={t("forms.empty.title")}
            body={t("forms.empty.body")}
            testId="qcms-forms-empty"
            action={
              <Link href="/forms/new" className="qcms-button-link">
                {t("forms.new")}
              </Link>
            }
          />
        ))}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* The POC's result count, above the table where it draws it. A plain
              paragraph rather than a live region, deliberately: Apply is a native form
              submission, so every change of this number arrives as a new document, which
              a screen reader announces as a page load. A live region here would be a
              promise to announce a change that never happens in place. */}
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-forms-count">
            {tPlural("forms.count.one", "forms.count.other", result.data.length)}
          </p>
          <FormsTable rows={result.data} />
          <p className="text-sm text-(--color-text-muted)">{t("forms.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
