// Storage Checker Live - Application Entry Point
// Prevents additional console window on Windows in release/normal runs
#![windows_subsystem = "windows"]

fn main() {
    storage_checker_live_lib::run();
}
