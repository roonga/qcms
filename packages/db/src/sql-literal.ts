/**
 * `'test'` from `test`: a SQL string literal, with the doubling rule, for the modules that
 * build DDL that cannot be parameterized.
 *
 * Not an escape hatch that makes arbitrary input safe to concatenate: every caller refuses
 * its input first, and this is the second line rather than the first.
 */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
