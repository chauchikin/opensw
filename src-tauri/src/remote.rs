//! Control channel for AI agents. The editor listens on a loopback port; the MCP
//! process (`opensw --mcp`, see mcp.rs) sends it `{cmd, args}` and the page runs
//! the command (window.sw in src/api.js) and sends the reply back through
//! `api_reply`. Only processes that can read the control file (port + token) of
//! this user can connect.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// How long a command may run in the page (typesetting can take a while).
const REPLY_TIMEOUT: Duration = Duration::from_secs(300);

/// Where the running editor writes its port and token; the MCP process reads it.
pub fn control_file() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        PathBuf::from(std::env::var_os("HOME")?).join(".local/share")
    };
    Some(base.join("com.ckwinlose.swnext").join("control.json"))
}

#[derive(Default)]
pub struct Pending {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    control: Mutex<String>, // the control file's text, written once the page listens
}

/// The page has registered its command listener: from now on agents may connect.
#[tauri::command]
pub fn api_ready(state: tauri::State<'_, Pending>) -> Result<(), String> {
    let file = control_file().ok_or("找不到使用者資料夾")?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = state.control.lock().unwrap_or_else(|e| e.into_inner()).clone();
    std::fs::write(&file, text).map_err(|e| e.to_string())
}

/// The page's answer to a command (JSON text `{ok, result}` or `{ok:false, error}`).
#[tauri::command]
pub fn api_reply(state: tauri::State<'_, Pending>, id: u64, reply: String) {
    let sender = state.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    if let Some(tx) = sender {
        let _ = tx.send(reply); // the caller may have timed out already
    }
}

fn random_token() -> String {
    let mut a = RandomState::new().build_hasher();
    a.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let mut b = RandomState::new().build_hasher();
    b.write_u32(std::process::id());
    format!("{:016x}{:016x}", a.finish(), b.finish())
}

/// Starts the listener in a background thread; `api_ready` then writes the control file.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token();
    let pending = Pending::default();
    *pending.control.lock().unwrap_or_else(|e| e.into_inner()) =
        serde_json::json!({ "port": port, "token": token, "pid": std::process::id() }).to_string();
    app.manage(pending);

    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            // one command at a time is enough for one agent; a bad request never stops the listener
            if let Err(e) = handle(&app, stream, &token) {
                eprintln!("opensw control: {e}");
            }
        }
    });
    Ok(())
}

/// Removes the control file when the editor closes, so the MCP process starts a new one.
pub fn stop() {
    if let Some(file) = control_file() {
        let _ = std::fs::remove_file(file);
    }
}

fn handle(app: &AppHandle, stream: TcpStream, token: &str) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let (headers, body) = read_request(&mut reader)?;
    let mut out = stream;
    if header(&headers, "x-sw-token") != Some(token) {
        return respond(&mut out, 403, r#"{"ok":false,"error":"token 不對"}"#);
    }
    let req: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let reply = run_in_page(app, &req["cmd"], &req["args"]);
    respond(&mut out, 200, &reply)
}

fn run_in_page(app: &AppHandle, cmd: &serde_json::Value, args: &serde_json::Value) -> String {
    let state = app.state::<Pending>();
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    state.waiting.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
    if let Err(e) = app.emit("sw-api", serde_json::json!({ "id": id, "cmd": cmd, "args": args })) {
        state.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        return serde_json::json!({ "ok": false, "error": e.to_string() }).to_string();
    }
    match rx.recv_timeout(REPLY_TIMEOUT) {
        Ok(reply) => reply,
        Err(_) => {
            state.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            serde_json::json!({ "ok": false, "error": "編輯器沒有回應（逾時）" }).to_string()
        }
    }
}

/// -> (lower-case headers, body)
pub fn read_request(reader: &mut impl BufRead) -> Result<(Vec<(String, String)>, String), String> {
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?; // request line
    let mut headers = Vec::new();
    loop {
        line.clear();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    let len: usize = header(&headers, "content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = vec![0; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok((headers, String::from_utf8(body).map_err(|e| e.to_string())?))
}

pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

fn respond(out: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let text = if status == 200 { "OK" } else { "Forbidden" };
    write!(
        out,
        "HTTP/1.1 {status} {text}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{header, read_request};

    #[test]
    fn read_request_should_return_headers_and_body() {
        let raw = "POST /call HTTP/1.1\r\nX-SW-Token: abc\r\nContent-Length: 5\r\n\r\nhello";
        let (headers, body) = read_request(&mut raw.as_bytes()).unwrap();
        assert_eq!((header(&headers, "x-sw-token"), body.as_str()), (Some("abc"), "hello"));
    }

    #[test]
    fn read_request_should_read_utf8_body_by_bytes() {
        let body = r#"{"cmd":"set","args":{"latex":"定理"}}"#;
        let raw = format!("POST /call HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        assert_eq!(read_request(&mut raw.as_bytes()).unwrap().1, body);
    }
}
