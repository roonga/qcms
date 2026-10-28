import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Effective privileges (`has_*_privilege`) rather than stored ACLs, since a `REVOKE` materialises a NULL ACL
 * without changing any privilege. Superusers are excluded; default ACLs and large objects stay on
 * `aclexplode`. `$1` is the list of schemas to leave out.
 */
const PRIVILEGE_MAP_PATH = fileURLToPath(
  new URL("../../privileges/privilege-map.sql", import.meta.url),
);

/** The effective privilege map as one SQL text, taking the schemas to exclude as `$1`. */
export const PRIVILEGE_MAP_SQL = readFileSync(PRIVILEGE_MAP_PATH, "utf8");

/** The query's path, for a caller that must read the same bytes itself. */
export { PRIVILEGE_MAP_PATH };
