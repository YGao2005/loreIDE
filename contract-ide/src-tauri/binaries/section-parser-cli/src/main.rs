//! section-parser-cli: stdin → stdout JSON wrapper for the contract section parser.
//!
//! Usage (called by MCP TypeScript sidecar via child_process.execFileSync):
//!
//! ```sh
//! echo "## Intent\n\nHello\n\n## Examples\n\nworld" | section-parser-cli
//! # {"section_hashes":{"examples":"<sha256>","intent":"<sha256>"}}
//! ```
//!
//! Exit 0 on success, exit 1 on parse error (outputs {"error":"<msg>"}).
//!
//! MCP sidecar spawn pattern (called from TypeScript via env-var path):
//!   const result = child_process.execFileSync(
//!     process.env.SECTION_PARSER_CLI_PATH,
//!     [],
//!     { input: body, encoding: "utf-8" }
//!   );
//!
//! The `SECTION_PARSER_CLI_PATH` env var is injected by the Tauri app at
//! MCP sidecar launch time (see 08-02 plan: extends launch_mcp_sidecar
//! CommandChild spawn to pass .env("SECTION_PARSER_CLI_PATH", resolved_path)).
//! Resolved via:
//!   app.path().resource_dir()?.join("binaries").join(
//!     format!("section-parser-cli-{target_triple}")
//!   )

mod section_parser;

use std::io::{self, Read};
use std::process;

fn main() {
    let mut body = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut body) {
        let err = serde_json::json!({ "error": format!("failed to read stdin: {e}") });
        println!("{}", err);
        process::exit(1);
    }

    match section_parser::compute_section_hashes(&body) {
        Ok(hashes) => {
            let output = serde_json::json!({ "section_hashes": hashes });
            println!("{}", output);
            process::exit(0);
        }
        Err(e) => {
            let err = serde_json::json!({ "error": format!("{e}") });
            println!("{}", err);
            process::exit(1);
        }
    }
}
