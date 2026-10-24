// A separate entry point so the API's configuration parser can derive one name at boot
// without pulling in the schema graph and Drizzle.
export { environmentDatabaseUrlVariableName } from "./naming.js";
