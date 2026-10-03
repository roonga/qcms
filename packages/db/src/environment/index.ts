/**
 * The environment surface of `@roonga/qcms-db`, exported separately from the runtime
 * query vocabulary.
 *
 * It is its own entry point because the API's configuration parser needs one name
 * derivation from it at **boot**, before any pool exists, and pulling the whole schema
 * graph and Drizzle in for one string would make the configuration module depend on the
 * database it is configuring.
 */
export { environmentDatabaseUrlVariableName } from "./naming.js";
