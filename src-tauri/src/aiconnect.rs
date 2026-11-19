//! Tools > Connect AI: puts opensw into the AI apps' lists of MCP servers on this computer, so
//! nobody has to edit those files by hand (docs/AI.md shows the entries). Each file is merged:
//! the other entries stay as they were, and the old file is first copied to
//! <file>.opensw-backup next to it.
//! - Claude desktop app: claude_desktop_config.json, "mcpServers" -> "opensw"
//!   (%APPDATA%\Claude, or %LOCALAPPDATA%\Claude-Data\claude_<id> in newer versions, or the
//!   Microsoft Store version's own copy: each one that is there is changed)
//! - Codex and the ChatGPT desktop app (they share it): ~/.codex/config.toml, [mcp_servers.opensw]
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
pub struct AiApp {
    id: &'static str,
    name: &'static str,
    /// the settings files opensw writes
    files: Vec<String>,
    /// the app is on this computer (its settings folder is there)
    found: bool,
    /// every file already starts this opensw
    connected: bool,
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn claude_files() -> Vec<PathBuf> {
    const NAME: &str = "claude_desktop_config.json";
    let mut out = Vec::new();
    if cfg!(windows) {
        if let Some(d) = std::env::var_os("APPDATA") {
            out.push(PathBuf::from(d).join("Claude").join(NAME));
        }
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let subfolders = |dir: PathBuf| std::fs::read_dir(dir).into_iter().flatten().flatten();
        if let Some(local) = local {
            // newer versions: %LOCALAPPDATA%\Claude-Data\claude_<id>
            for e in subfolders(local.join("Claude-Data")) {
                if e.file_name().to_string_lossy().starts_with("claude_") && e.path().is_dir() {
                    out.push(e.path().join(NAME));
                }
            }
            // Microsoft Store: %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude
            for e in subfolders(local.join("Packages")) {
                let dir = e.path().join("LocalCache").join("Roaming").join("Claude");
                if e.file_name().to_string_lossy().starts_with("Claude_") && dir.is_dir() {
                    out.push(dir.join(NAME));
                }
            }
        }
    } else if let Some(h) = home() {
        let dir = if cfg!(target_os = "macos") { h.join("Library/Application Support/Claude") } else { h.join(".config/Claude") };
        out.push(dir.join(NAME));
    }
    out
}

fn codex_file() -> Option<PathBuf> {
    let dir = std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".codex")))?;
    Some(dir.join("config.toml"))
}

fn files(id: &str) -> Vec<PathBuf> {
    match id {
        "claude" => claude_files(),
        "codex" => codex_file().into_iter().collect(),
        _ => Vec::new(),
    }
}

fn exe() -> Result<String, String> {
    std::env::current_exe().map(|p| p.display().to_string()).map_err(|e| e.to_string())
}

/// claude_desktop_config.json with opensw in "mcpServers" (empty text: a new file)
pub fn merge_claude(text: &str, exe: &str) -> Result<String, String> {
    let mut root: Value = if text.trim().is_empty() { json!({}) } else { serde_json::from_str(text).map_err(|e| format!("The settings file is not valid JSON: {e}"))? };
    let Some(top) = root.as_object_mut() else {
        return Err("The settings file is not valid JSON: it is not an object".into());
    };
    let servers = top.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Err("The settings file is not valid JSON: mcpServers is not an object".into());
    };
    servers.insert("opensw".into(), json!({ "command": exe, "args": ["--mcp"] }));
    serde_json::to_string_pretty(&root).map(|s| s + "\n").map_err(|e| e.to_string())
}

fn claude_connected(text: &str, exe: &str) -> bool {
    serde_json::from_str::<Value>(text).ok().and_then(|v| v["mcpServers"]["opensw"]["command"].as_str().map(|c| c == exe)).unwrap_or(false)
}

/// a TOML string for the path: a literal '...' string unless the path has a ' in it
fn toml_string(s: &str) -> String {
    if s.contains('\'') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        format!("'{s}'")
    }
}

/// config.toml with an [mcp_servers.opensw] table (an old one, and its sub-tables, is replaced)
pub fn merge_codex(text: &str, exe: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            let name = t.trim_start_matches('[').split(']').next().unwrap_or("").trim();
            skipping = name == "mcp_servers.opensw" || name.starts_with("mcp_servers.opensw.");
        }
        if !skipping {
            out.push(line);
        }
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    let mut s = out.join("\n");
    if !s.is_empty() {
        s.push_str("\n\n");
    }
    s.push_str(&format!("[mcp_servers.opensw]\ncommand = {}\nargs = [\"--mcp\"]\n", toml_string(exe)));
    s
}

fn codex_connected(text: &str, exe: &str) -> bool {
    text.lines().any(|l| l.trim() == "[mcp_servers.opensw]") && text.contains(&toml_string(exe))
}

fn connected(id: &str, text: &str, exe: &str) -> bool {
    if id == "claude" { claude_connected(text, exe) } else { codex_connected(text, exe) }
}

/// the AI apps opensw can connect to, and whether they are on this computer and connected
#[tauri::command]
pub fn ai_apps() -> Vec<AiApp> {
    let exe = exe().unwrap_or_default();
    [("claude", "Claude"), ("codex", "ChatGPT / Codex")]
        .into_iter()
        .map(|(id, name)| {
            let fs = files(id);
            let found = fs.iter().any(|f| f.parent().is_some_and(Path::is_dir));
            let connected = found
                && fs.iter().filter(|f| f.parent().is_some_and(Path::is_dir)).all(|f| connected(id, &std::fs::read_to_string(f).unwrap_or_default(), &exe));
            AiApp { id, name, files: fs.iter().map(|f| f.display().to_string()).collect(), found, connected }
        })
        .collect()
}

/// adds opensw to the app's settings files; -> the files written
#[tauri::command]
pub fn ai_connect(id: String) -> Result<Vec<String>, String> {
    let exe = exe()?;
    let targets: Vec<PathBuf> = files(&id).into_iter().filter(|f| f.parent().is_some_and(Path::is_dir)).collect();
    if targets.is_empty() {
        return Err(format!("{id} is not on this computer (its settings folder was not found)"));
    }
    let mut written = Vec::new();
    for file in targets {
        let old = std::fs::read_to_string(&file).unwrap_or_default();
        let new = if id == "claude" { merge_claude(&old, &exe).map_err(|e| format!("Cannot change {}: {e}", file.display()))? } else { merge_codex(&old, &exe) };
        if file.exists() {
            let backup = PathBuf::from(format!("{}.opensw-backup", file.display()));
            std::fs::copy(&file, &backup).map_err(|e| format!("Cannot make a backup copy of {}: {e}", file.display()))?;
        }
        std::fs::write(&file, new).map_err(|e| format!("Cannot write {}: {e}", file.display()))?;
        written.push(file.display().to_string());
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Users\prof\AppData\Local\opensw\opensw.exe";

    #[test]
    fn claude_keeps_the_other_entries() {
        let old = r#"{ "preferences": { "x": 1 }, "mcpServers": { "files": { "command": "npx", "args": ["fs"] } } }"#;
        let new = merge_claude(old, EXE).unwrap();
        let v: Value = serde_json::from_str(&new).unwrap();
        assert_eq!(v["preferences"]["x"], 1);
        assert_eq!(v["mcpServers"]["files"]["command"], "npx");
        assert_eq!(v["mcpServers"]["opensw"]["command"], EXE);
        assert_eq!(v["mcpServers"]["opensw"]["args"][0], "--mcp");
        assert!(new.find("preferences").unwrap() < new.find("mcpServers").unwrap(), "order kept");
        assert!(claude_connected(&new, EXE) && !claude_connected(old, EXE));
    }

    #[test]
    fn claude_new_file_and_bad_file() {
        assert!(claude_connected(&merge_claude("", EXE).unwrap(), EXE));
        assert!(merge_claude("{ not json", EXE).is_err());
        assert!(merge_claude("[1]", EXE).is_err());
        assert!(merge_claude(r#"{"mcpServers": 3}"#, EXE).is_err());
    }

    #[test]
    fn codex_replaces_only_its_own_table() {
        let old = "model = 'o3'\n\n[mcp_servers.opensw]\ncommand = 'D:\\old\\opensw.exe'\nargs = [\"--mcp\"]\n\n[mcp_servers.opensw.env]\nA = '1'\n\n[mcp_servers.other]\ncommand = 'x'\n";
        let new = merge_codex(old, EXE);
        assert!(new.starts_with("model = 'o3'\n"));
        assert!(new.contains("[mcp_servers.other]\ncommand = 'x'"));
        assert!(!new.contains("old") && !new.contains("opensw.env"));
        assert_eq!(new.matches("[mcp_servers.opensw]").count(), 1);
        assert!(new.ends_with(&format!("[mcp_servers.opensw]\ncommand = '{EXE}'\nargs = [\"--mcp\"]\n")));
        assert!(codex_connected(&new, EXE) && !codex_connected(old, EXE));
        assert_eq!(merge_codex("", EXE), format!("[mcp_servers.opensw]\ncommand = '{EXE}'\nargs = [\"--mcp\"]\n"));
        assert_eq!(toml_string("C:\\it's"), "\"C:\\\\it's\"");
    }
}
