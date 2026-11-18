// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `opensw --mcp`: MCP server for AI apps (stdin/stdout), no window
    if std::env::args().any(|a| a == "--mcp") {
        opensw_lib::mcp::run();
    } else {
        opensw_lib::run();
    }
}
