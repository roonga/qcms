import { customType } from "drizzle-orm/pg-core";

/**
 * `jsonb` that keeps the driver's own parse: drizzle's `jsonb` parses any string handed
 * to it and node-postgres has already parsed the column, so a stored JSON string would be
 * parsed twice. Needed only where a top-level value can be a string, number or boolean;
 * the other jsonb columns hold objects. The SQL type is unchanged.
 */
export function jsonbValue<TData>(name: string) {
  return customType<{ data: TData; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => value as TData,
  })(name);
}
