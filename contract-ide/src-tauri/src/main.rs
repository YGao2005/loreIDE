// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// NEVER add #[tokio::main] here — Tauri owns the async runtime.
// Use tauri::async_runtime::spawn() for background work instead.
// See RESEARCH.md Pitfall 1 / GitHub tauri-apps/tauri#13330.

fn main() {
    contract_ide_lib::run()
}
