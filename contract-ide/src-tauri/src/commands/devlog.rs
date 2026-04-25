// Dev-only append-to-file logger. Frontend console.* is mirrored here so
// an external tailer (e.g. `tail -f /tmp/contract-ide.log`) can observe the
// running app without the user pasting console output by hand.

use std::fs::OpenOptions;
use std::io::Write;

const LOG_PATH: &str = "/tmp/contract-ide.log";

#[tauri::command]
pub fn devlog(line: String) -> Result<(), String> {
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG_PATH)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}
