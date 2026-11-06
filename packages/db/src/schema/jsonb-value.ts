import { customType } from "drizzle-orm/pg-core";

/**
 * `jsonb` for a column whose top-level value can be a JSON string, number or boolean.
 *
 * drizzle's own `jsonb` column parses any string the driver hands it, and node-postgres
 * has already parsed the column, so a stored JSON string is parsed twice: `"42"` reads
 * back as the number 42, `"true"` as a boolean and `"null"` as SQL NULL. The SQL type is
 * unchanged, so this is interchangeable with `jsonb()` in a migration diff.
 */
export function jsonbValue<TData>(name: string) {
  return customType<{ data: TData; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => value as TData,
  })(name);
}
