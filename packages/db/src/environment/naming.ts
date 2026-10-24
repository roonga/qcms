/**
 * The one copy of the `QCMS_DATABASE_URL_<ENV>` spelling: `apps/api/src/config.ts` reads
 * the variable and the environment command tells an operator to set it.
 */
export function environmentDatabaseUrlVariableName(environment: string): string {
  return `QCMS_DATABASE_URL_${environment.toUpperCase()}`;
}
