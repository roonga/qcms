/**
 * The one name derivation both the database package and the API need.
 *
 * `apps/api/src/config.ts` reads `QCMS_DATABASE_URL_<ENV>` and the environment command
 * tells an operator to set it. Two copies of that spelling is one copy too many: the
 * command would keep saying `QCMS_DATABASE_URL_DEV` long after the variable had been
 * renamed, and an operator following it would configure nothing.
 */

/** `QCMS_DATABASE_URL_TEST` from `test`. */
export function environmentDatabaseUrlVariableName(environment: string): string {
  return `QCMS_DATABASE_URL_${environment.toUpperCase()}`;
}
