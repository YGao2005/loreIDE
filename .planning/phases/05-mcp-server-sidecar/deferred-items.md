# Deferred Items — Phase 05

Out-of-scope issues discovered during execution, logged here per executor scope rules.

## Plan 05-01

- **Clippy warning in `src-tauri/src/commands/validation.rs:71`** — `map_or(false, ...)` can be simplified to `is_some_and(...)`. Pre-existing from Plan 01-04 (`validation.rs` module marked for deletion in Phase 9 polish anyway per STATE.md Pending Todos). Not triggered by Plan 05-01 changes; `mcp.rs` itself has zero clippy warnings.

## Plan 05-02

- **`tsc --noEmit` reports TS2589 "Type instantiation is excessively deep and possibly infinite" on `mcp-sidecar/src/index.ts:14`** — pre-existing from Plan 05-01. Root cause is the MCP SDK's heavily-generic `server.tool(name, description, schemaShape, handler)` overload expanding Zod schema inference to a depth `tsc` refuses to trace. The esbuild bundler path (which IS the shipping compile) ignores it and the runtime binary works correctly (JSON-RPC smoke test verified all four tool schemas serialise properly). Fix requires either an MCP SDK upgrade that simplifies the generics, explicit input-schema type parameters at each `server.tool()` call site, or a `// @ts-expect-error` annotation. Out-of-scope for Plan 05-02 (unchanged by its edits). Revisit alongside the MCP SDK v2 migration tracked in STATE.md Blockers.
