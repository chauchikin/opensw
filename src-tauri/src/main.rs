// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `opensw --mcp`: MCP server for AI apps (stdin/stdout), no window
    if std::env::args().any(|a| a == "--mcp") {
        sw_next_lib::mcp::run();
    } else {
        sw_next_lib::run();
    }
}
