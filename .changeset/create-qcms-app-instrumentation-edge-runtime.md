---
"create-qcms-app": patch
---

The scaffolded `instrumentation.ts` no longer references `process.stderr` on the Edge
Runtime compilation path (issue #829). Next compiles that hook for the edge target as
well as the Node one, and `process.stderr` is a Node API the edge runtime does not have,
so an adopter saw `Ecmascript file had an error` from Turbopack on every dev boot and
every build of a freshly scaffolded app. The boot-refusal write now sits inside a
`process.env.NEXT_RUNTIME === "nodejs"` block, which Next's build-time substitution turns
into dead code on the edge target and leaves untouched on the Node one, so the refusal an
operator reads is byte for byte what it was.

Templates are generated from `apps/`, so this is the same edit the repository's own admin
and portal carry, regenerated with `pnpm qcms:sync-templates`.
