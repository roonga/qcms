---
"@roonga/qcms-observability": patch
"@roonga/qcms-ui": patch
---

Dependency maintenance. The public API of both packages is identical; the ranges
below moved, and one type name inside `@roonga/qcms-observability` moved with them.

`@opentelemetry/sdk-logs` 0.222.0 deprecates `SdkLogRecord`, which is now an alias
for `ReadWriteLogRecord`, so `packages/observability/src/otlp-log-allowlist.ts`
names the successor type instead. It is the same type under a new name, used on a
type-only import and one internal signature, so nothing a consumer imports or calls
changes and the SEC-13 redaction behaviour is untouched.

**@roonga/qcms-observability**

Ranges a consumer resolves against:

- `@opentelemetry/api-logs` ^0.221.0 to ^0.222.0 (dependencies)
- `@opentelemetry/sdk-logs` ^0.221.0 to ^0.222.0 (dependencies)
- `@opentelemetry/sdk-trace-base` ^2.10.0 to ^2.11.0 (dependencies)

**@roonga/qcms-ui**

Ranges a consumer resolves against:

- `@internationalized/date` ^3.12.3 to ^3.12.4 (dependencies)
- `react-aria-components` ^1.20.0 to ^1.21.0 (dependencies)
