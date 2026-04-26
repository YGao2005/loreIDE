// Source: derived from contract-ide-demo/next.config.ts — Phase 14 Plan 14-01b.
//
// Insertion-ready snippet that Plan 14-05's emit script splices into the
// target repo's next.config.ts. The BOOTSTRAP-INSERT-START / -END markers
// delimit the region the emit script can find-and-replace idempotently
// across re-runs (no duplicate insertions).
//
// Sync strategy: re-copy the webpack hook from contract-ide-demo/next.config.ts
// when the loader's invocation contract changes. The hook below is a verbatim
// match of contract-ide-demo's modulo the inline comments.

// BOOTSTRAP-INSERT-START contract-uuid-plugin
// Injects `data-contract-uuid="<uuid>"` on JSX elements that match L4 UI
// atom code_ranges in .contracts/*.md. Custom webpack loader (NOT
// babel-loader) — runs before Next.js's SWC pipeline. No .babelrc needed;
// SWC is NOT disabled.
import path from "node:path";

export const contractUuidWebpackHook = (config: any) => {
  config.module.rules.push({
    test: /\.tsx$/,
    use: [
      {
        // contract-uuid-plugin/index.js is a custom webpack loader (not
        // babel-loader). It pre-processes .tsx source by injecting
        // data-contract-uuid attributes, then SWC handles the rest.
        loader: path.resolve(__dirname, "contract-uuid-plugin", "index.js"),
      },
    ],
    // Only apply to source files (not node_modules).
    exclude: /node_modules/,
  });
  return config;
};
// BOOTSTRAP-INSERT-END contract-uuid-plugin

// Usage in target's next.config.ts:
//
//   import { contractUuidWebpackHook } from "./contract-uuid-plugin/next-config-snippet";
//
//   const nextConfig: NextConfig = {
//     webpack: contractUuidWebpackHook,
//     // ...other Next.js config
//   };
//
// If the target already has a `webpack:` hook, the emit script (Plan 14-05)
// composes them — calls the existing hook first, then runs
// contractUuidWebpackHook(config) on the result.
