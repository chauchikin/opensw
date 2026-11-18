//! `opensw --mcp`: an MCP server (JSON-RPC over stdin/stdout) so AI apps such as
//! Claude or Codex can drive the editor. Each tool call is passed to the running
//! editor through its control channel (remote.rs); the editor is started when it
//! is not running.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::remote::control_file;

/// Tool list generated from src/api.js COMMANDS (scripts/gen-mcp-tools.mjs).
const TOOLS: &str = include_str!("../mcp-tools.json");
const PREFIX: &str = "sw_";

pub fn run() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        // a line that is not JSON-RPC gets a parse error, the server keeps running
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => answer(&msg),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(r) = reply
            && writeln!(out, "{r}").and_then(|_| out.flush()).is_err()
        {
            break;
        }
    }
}

/// A JSON-RPC message -> the response, or None for notifications.
pub fn answer(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "scientific-word-next", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "opensw（Scientific Word 5.5 風格的數學文件編輯器）。文件以區塊為單位：先用 sw_outline 看區塊編號，再用 sw_insert / sw_replaceBlock 改；內容一律寫 LaTeX。開 .sci 或 Scientific Word 5.x 的 .tex 用 sw_open，存檔 sw_save，排版 PDF 用 sw_typeset。"
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": serde_json::from_str::<Value>(TOOLS).unwrap_or(json!([])) })),
        "tools/call" => Ok(call_tool(&msg["params"])),
        _ => Err(json!({ "code": -32601, "message": format!("unknown method {method}") })),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

fn call_tool(params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let cmd = name.strip_prefix(PREFIX).unwrap_or(name);
    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    let reply = send(cmd, &args).unwrap_or_else(|e| json!({ "ok": false, "error": e }));
    let ok = reply["ok"].as_bool().unwrap_or(false);
    let text = if ok {
        match &reply["result"] {
            Value::String(s) => s.clone(),
            v => serde_json::to_string_pretty(v).unwrap_or_default(),
        }
    } else {
        reply["error"].as_str().unwrap_or("失敗").to_string()
    };
    json!({ "content": [{ "type": "text", "text": text }], "isError": !ok })
}

/// Sends one command to the editor, starting it first when needed.
fn send(cmd: &str, args: &Value) -> Result<Value, String> {
    match try_send(cmd, args) {
        Ok(v) => Ok(v),
        Err(_) => {
            start_editor()?;
            try_send(cmd, args)
        }
    }
}

fn try_send(cmd: &str, args: &Value) -> Result<Value, String> {
    let file = control_file().ok_or("找不到使用者資料夾")?;
    let info: Value = serde_json::from_str(&std::fs::read_to_string(&file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let port = info["port"].as_u64().ok_or("控制檔沒有 port")?;
    let token = info["token"].as_str().ok_or("控制檔沒有 token")?;
    let mut stream = TcpStream::connect(("127.0.0.1", port as u16)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(320))).map_err(|e| e.to_string())?;
    let body = json!({ "cmd": cmd, "args": args }).to_string();
    write!(
        stream,
        "POST /call HTTP/1.1\r\nHost: 127.0.0.1\r\nX-SW-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader.read_line(&mut status).map_err(|e| e.to_string())?;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 || line.trim_end().is_empty() {
            break;
        }
    }
    let mut text = String::new();
    reader.read_to_string(&mut text).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("{status}: {e}"))
}

/// Opens the editor window (this same program without --mcp) and waits until it listens.
fn start_editor() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(file) = control_file() {
        let _ = std::fs::remove_file(file); // stale file from an editor that did not close cleanly
    }
    // its own stdin/stdout must not mix into the MCP stream
    std::process::Command::new(exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("打不開編輯器：{e}"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(500));
        if control_file().is_some_and(|f| f.exists()) {
            std::thread::sleep(Duration::from_millis(1500)); // let the page finish loading
            return Ok(());
        }
    }
    Err("編輯器 30 秒內沒有開好".to_string())
}

#[cfg(test)]
mod tests {
    use super::answer;
    use serde_json::json;

    #[test]
    fn initialize_should_report_tools_capability() {
        let r = answer(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
        assert!(r["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_should_include_outline() {
        let r = answer(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = r["result"]["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"sw_outline"));
    }

    #[test]
    fn notifications_should_get_no_reply() {
        assert!(answer(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
    }

    #[test]
    fn unknown_method_should_be_an_error() {
        let r = answer(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).unwrap();
        assert_eq!(r["error"]["code"], -32601);
    }
}
