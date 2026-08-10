/**
 * The API keeps this compatibility surface so its injected logger imports do not
 * depend on the workspace package name. The implementation is shared with both
 * Next BFFs by task 062.
 */
export {
  createJsonLogger,
  createNullLogger,
  type JsonLoggerOptions,
  type LogFields,
  type LogLevel,
  type Logger,
} from "@qcms/observability/logger";
