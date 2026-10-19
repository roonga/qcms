---
"@roonga/qcms-ui": minor
---

Draw the no-JS date fallback in the renderer's locale order, and export the kit's locale boundary (Code Owner ruling 2026-10-19).

Native-submit mode used to render a date question as one `<input type="date">`, whose day, month and year order is the browser's own and cannot be moved from the markup. The hydrated DatePicker draws its segments in the `locale` the renderer is given, so a respondent whose browser and deployment disagreed watched the order change as the page hydrated. `NativeDateField` is now a fieldset whose legend is the question's label, holding labelled day, month and year boxes in the order `Intl` gives for the renderer's `locale` (read through react-aria's `I18nProvider`), so the two renders of one question always agree.

The wire changes for this field only: each box posts under its own name (`__qdd__`, `__qdm__`, `__qdy__` before the questionId) and the field's kind tag is the new `date`. `@roonga/qcms-ui/native-submit` exports `NATIVE_DATE_PART_PREFIX`, `dateSegmentOrder`, `assembleNativeDate` (joins the three parts into `YYYY-MM-DD`, padding digits and passing anything else through for the API to judge; three blank boxes are absence) and `splitNativeDate`, so a host's decoder joins the parts with the renderer's own rule. A decoder that only knew the four earlier kinds ignores the new one. The ISO `min`/`max` bounds are no longer native attributes; the API still enforces them. The table presentation clips the fieldset's legend exactly as it clips a label.

The renderer now draws every control on `isoDateLocale(locale)`, the given tag with the Gregorian calendar and Latin digits forced (exported from `@roonga/qcms-ui/native-submit`). A date answer is an ISO day, so a tag whose default calendar is not Gregorian (`th-TH`, `fa-IR`) or that carries a `-u-ca-` extension no longer draws the stored value as a different date, in different digits or in a different part order on the hydrated render than on the no-JS one. Part order, month names and separators still follow the tag.

`@roonga/qcms-ui/kit` also re-exports react-aria's `I18nProvider`, so an app can name the locale its kit date pickers order and format dates in rather than inheriting the browser's, which react-aria cannot see during a server render.
