//! Tools > Computation Engine: the Compute menu done by a program on this computer
//! (Mathematica, or any engine listed in engine/engines.json; see ENGINE.md). Each engine's
//! program is kept running, so only the first computation waits for it to start. The program
//! loads an adapter file from engine/; each computation is one line in and one line out, both
//! base64 so no console code page can garble them:
//!   in:  the engine's `call` line, with {op} and {data} (the MathJSON request in base64)
//!   out: a line containing @@OPENSW@@ followed by the JSON answer in base64
//! Other output lines (a start-up banner, messages) are skipped. A program that has not
//! answered after PATIENCE is stopped; the next computation starts it again.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MARK: &str = "@@OPENSW@@";
/// How long a program may take to answer. The adapters give up on one computation after a
/// minute themselves ($timeLimit in opensw_compute.wl); this is for a program that says nothing.
const PATIENCE: Duration = Duration::from_secs(if cfg!(test) { 2 } else { 120 });

/// One entry of engine/engines.json.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Spec {
    pub id: String,
    pub name: String,
    /// where to look for the program; the newest version found wins (see find_program)
    pub program: Vec<String>,
    /// a path shown in Tools > Computation Engine as an example
    #[serde(default)]
    pub example: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// the file in engine/ the program loads (it answers the call lines)
    pub adapter: String,
    /// the line that loads the adapter and prints @@OPENSW@@ready; empty when the program
    /// loads it from its arguments and prints that line itself
    #[serde(default)]
    pub load: String,
    pub call: String,
}

#[derive(Deserialize)]
struct List {
    engines: Vec<Spec>,
}

/// The engines in engines.json of `dir` (the engine folder).
pub fn list(dir: &Path) -> Result<Vec<Spec>, String> {
    let text = std::fs::read_to_string(dir.join("engines.json")).map_err(|e| format!("Cannot read the list of computation engines, engines.json: {e}"))?;
    serde_json::from_str::<List>(&text).map(|l| l.engines).map_err(|e| format!("The list of computation engines, engines.json, is not in the right format: {e}"))
}

struct Running {
    program: PathBuf,
    child: Arc<Mutex<Child>>,
    input: ChildStdin,
    /// the lines the program prints, read by a thread of its own so that waiting for one can end
    lines: Receiver<std::io::Result<String>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        kill(&self.child);
        if let Ok(mut all) = CHILDREN.lock() {
            all.retain(|c| !Arc::ptr_eq(c, &self.child));
        }
    }
}

fn kill(child: &Mutex<Child>) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// engine id -> its running program (held for the whole of a computation)
static RUNNING: Mutex<Option<HashMap<String, Running>>> = Mutex::new(None);
/// the running programs again, so that closing the editor can stop one that a computation is
/// still waiting for
static CHILDREN: Mutex<Vec<Arc<Mutex<Child>>>> = Mutex::new(Vec::new());

/// The program: the one the user chose, otherwise the newest one found where the engine
/// says to look ("*" stands for any folder name; the numbers in a path are its version;
/// "{engine}" at the start is the engine folder `dir`: a program that comes with opensw),
/// otherwise the first bare name (a program on the PATH). An engine without a bare name is
/// never looked for on the PATH: its first place is returned, for the message.
fn find_program(spec: &Spec, dir: &Path, chosen: Option<&str>) -> PathBuf {
    if let Some(p) = chosen.map(str::trim).filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    let mut found: Option<(Vec<u32>, PathBuf)> = None;
    for pattern in &spec.program {
        let paths = match in_engine_folder(pattern, dir) {
            Some(path) if path.is_file() => vec![path],
            Some(_) => Vec::new(),
            None => expand(pattern),
        };
        for path in paths {
            let version: Vec<u32> = path
                .to_string_lossy()
                .split(|c: char| !c.is_ascii_digit())
                .filter_map(|n| n.parse().ok())
                .collect();
            if found.as_ref().is_none_or(|(v, _)| version > *v) {
                found = Some((version, path));
            }
        }
    }
    if let Some((_, path)) = found {
        return path;
    }
    let bare = spec.program.iter().find(|p| !p.contains(['/', '\\']));
    let first = spec.program.first().map_or(spec.id.as_str(), String::as_str);
    bare.map_or_else(|| in_engine_folder(first, dir).unwrap_or_else(|| PathBuf::from(first)), PathBuf::from)
}

/// "{engine}/python/python.exe" -> that file in the engine folder
fn in_engine_folder(pattern: &str, dir: &Path) -> Option<PathBuf> {
    let rest = pattern.strip_prefix("{engine}")?;
    Some(rest.split(['/', '\\']).filter(|part| !part.is_empty()).fold(dir.to_path_buf(), |path, part| path.join(part)))
}

/// The existing files a pattern names; "*" in a folder name matches any folder there.
fn expand(pattern: &str) -> Vec<PathBuf> {
    if !pattern.contains(['/', '\\']) {
        return Vec::new(); // a bare name: looked for on the PATH by the system
    }
    let mut paths = vec![PathBuf::new()];
    let parts: Vec<&str> = pattern.split(['/', '\\']).collect();
    for (i, part) in parts.iter().enumerate() {
        let last = i == parts.len() - 1;
        if i == 0 {
            // "C:" or "" (a path starting with /)
            paths = vec![PathBuf::from(format!("{part}{}", std::path::MAIN_SEPARATOR))];
            continue;
        }
        paths = if *part == "*" {
            paths
                .iter()
                .filter_map(|p| std::fs::read_dir(p).ok())
                .flat_map(|dirs| dirs.flatten().map(|d| d.path()).filter(|d| d.is_dir()))
                .collect()
        } else {
            paths.iter().map(|p| p.join(part)).filter(|p| if last { p.is_file() } else { p.is_dir() }).collect()
        };
    }
    paths
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, &b)| n | (b as u32) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ABC[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn is_base64(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

/// {adapter} and {adapter64} in a line of engines.json
fn with_adapter(text: &str, adapter: &Path) -> String {
    let path = adapter.to_string_lossy();
    text.replace("{adapter64}", &base64(path.as_bytes())).replace("{adapter}", &path)
}

impl Running {
    fn start(spec: &Spec, dir: &Path, program: PathBuf) -> Result<Running, String> {
        let name = &spec.name;
        let adapter = dir.join(&spec.adapter);
        let mut cmd = Command::new(&program);
        cmd.args(spec.args.iter().map(|a| with_adapter(a, &adapter)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Cannot find {name} ({}): {e}. Its location can be set in Tools > Computation Engine", program.display()))?;
        let input = child.stdin.take().ok_or(format!("{name} has no input pipe"))?;
        let mut output = BufReader::new(child.stdout.take().ok_or(format!("{name} has no output pipe"))?);
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            loop {
                let mut text = String::new();
                let read = output.read_line(&mut text);
                let more = matches!(read, Ok(n) if n > 0);
                if send.send(read.map(|_| text)).is_err() || !more {
                    break; // nobody is listening any more, or the program stopped
                }
            }
        });
        let child = Arc::new(Mutex::new(child));
        if let Ok(mut all) = CHILDREN.lock() {
            all.push(child.clone());
        }
        let mut running = Running { program, child, input, lines };
        let ready = if spec.load.is_empty() {
            running.read_answer(name)?
        } else {
            running.send(name, &with_adapter(&spec.load, &adapter))?
        };
        if ready != "ready" {
            return Err(format!("{name} could not load the opensw engine: {ready}"));
        }
        Ok(running)
    }

    /// One line in; the answer line out.
    fn send(&mut self, name: &str, line: &str) -> Result<String, String> {
        writeln!(self.input, "{line}")
            .and_then(|_| self.input.flush())
            .map_err(|e| format!("{name} stopped ({e}); it will start again on the next computation"))?;
        self.read_answer(name)
    }

    /// The text after the mark on the first line that has it.
    fn read_answer(&mut self, name: &str) -> Result<String, String> {
        let gone = |e: String| format!("{name} stopped ({e}); it will start again on the next computation");
        let until = Instant::now() + PATIENCE;
        loop {
            let text = match self.lines.recv_timeout(until.saturating_duration_since(Instant::now())) {
                Ok(line) => line.map_err(|e| gone(e.to_string()))?,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!("{name} did not answer within {} seconds and was stopped; it will start again on the next computation", PATIENCE.as_secs()));
                }
                Err(RecvTimeoutError::Disconnected) => String::new(),
            };
            if text.is_empty() {
                return Err(gone("no answer".into()));
            }
            if let Some(i) = text.find(MARK) {
                return Ok(text[i + MARK.len()..].trim_end_matches(|c: char| c.is_whitespace() || c == '"').to_string());
            }
        }
    }
}

/// The answer of one computation, and whether the engine's program was (re)started for it
/// (it then has none of the definitions made before: the editor sends them again).
#[derive(Serialize, Debug, PartialEq)]
pub struct Answer {
    pub data: String,
    pub started: bool,
}

/// One computation by the engine `id` of the engine folder `dir`: op (a word like "factor")
/// and the MathJSON text as base64 -> the JSON answer as base64. The program is started on
/// first use (or again after it stopped, or when the user chose another one).
pub fn compute(dir: &Path, id: &str, program: Option<&str>, op: &str, data: &str) -> Result<Answer, String> {
    if op.is_empty() || !op.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') || !is_base64(data) {
        return Err("The computation request is not in the right format".into());
    }
    let spec = list(dir)?.into_iter().find(|s| s.id == id).ok_or(format!("The list of computation engines has no {id}"))?;
    let path = find_program(&spec, dir, program);
    let mut all = RUNNING.lock().map_err(|e| e.to_string())?;
    let all = all.get_or_insert_with(HashMap::new);
    if all.get(id).is_some_and(|r| r.program != path) {
        all.remove(id); // another program was chosen
    }
    let started = !all.contains_key(id);
    if started {
        all.insert(id.to_string(), Running::start(&spec, dir, path)?);
    }
    let line = spec.call.replace("{op}", op).replace("{data}", data);
    let answer = all.get_mut(id).map(|r| r.send(&spec.name, &line));
    match answer {
        Some(Ok(a)) if is_base64(&a) => Ok(Answer { data: a, started }),
        Some(Ok(a)) => Err(format!("{} answered something unreadable: {a}", spec.name)),
        Some(Err(e)) => {
            all.remove(id);
            Err(e)
        }
        None => unreachable!("the engine was just started"),
    }
}

/// Stops every engine when the editor closes: the programs first, so that a computation still
/// waiting for one ends (it holds RUNNING until then).
pub fn stop() {
    let children = CHILDREN.lock().map(|all| all.clone()).unwrap_or_default();
    children.iter().for_each(|child| kill(child));
    if let Ok(mut all) = RUNNING.try_lock() {
        *all = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(program: &str) -> Spec {
        serde_json::from_value(serde_json::json!({
            "id": "fake", "name": "Fake", "program": [program], "args": ["-noprompt"],
            "adapter": "fake.wl", "load": "Get[\"{adapter64}\"]", "call": "Compute[\"{op}\", \"{data}\"]"
        }))
        .unwrap()
    }

    #[test]
    fn base64_should_match_the_standard_alphabet() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64("C:\\使用者\\a.wl".as_bytes()), "Qzpc5L2/55So6ICFXGEud2w=");
    }

    #[test]
    fn the_bundled_list_should_read() {
        let engines = list(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine")).unwrap();
        let m = engines.iter().find(|s| s.id == "mathematica").unwrap();
        assert!(Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine").join(&m.adapter).is_file());
        assert!(m.call.contains("{op}") && m.call.contains("{data}") && m.load.contains("{adapter64}"));
        // SymPy by the Python that comes with opensw: only ever the one in the engine folder
        let p = engines.iter().find(|s| s.id == "python").unwrap();
        assert!(Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine").join(&p.adapter).is_file());
        assert!(p.program.iter().all(|place| place.starts_with("{engine}/")), "{:?}", p.program);
        assert!(p.load.is_empty() && p.args.iter().any(|a| a == "{adapter}"));
    }

    #[test]
    fn compute_should_refuse_odd_input() {
        let dir = std::env::temp_dir();
        assert!(compute(&dir, "fake", Some("/nonexistent"), "fac tor", "eA==").is_err());
        assert!(compute(&dir, "fake", Some("/nonexistent"), "factor", "x\"]; Run[\"rm\"]").is_err());
    }

    #[test]
    fn find_program_should_use_the_chosen_path_then_the_newest_version() {
        assert_eq!(find_program(&spec("x"), Path::new("/e"), Some(" /opt/w/wolfram ")), PathBuf::from("/opt/w/wolfram"));
        let root = std::env::temp_dir().join("opensw-find-program");
        for v in ["9.0", "14.3", "14.10", "Readme"] {
            std::fs::create_dir_all(root.join("W").join(v)).unwrap();
        }
        for v in ["9.0", "14.3", "14.10"] {
            std::fs::write(root.join("W").join(v).join("k.exe"), "").unwrap();
        }
        let pattern = format!("{}/W/*/k.exe", root.display());
        assert_eq!(find_program(&spec(&pattern), Path::new("/e"), None), root.join("W").join("14.10").join("k.exe"));
        let mut s = spec(&format!("{}/nothing/*/k.exe", root.display()));
        s.program.push("wolfram".into());
        assert_eq!(find_program(&s, Path::new("/e"), None), PathBuf::from("wolfram"));
    }

    #[test]
    fn a_program_that_comes_with_opensw_should_be_found_in_the_engine_folder_only() {
        let dir = std::env::temp_dir().join("opensw-engine-folder");
        std::fs::create_dir_all(dir.join("python")).unwrap();
        let _ = std::fs::remove_file(dir.join("python").join("python.exe"));
        let mut s = spec("{engine}/python/python.exe");
        s.id = "python".into();
        // not there: the place it should be (so starting it fails), never "python" on the PATH
        assert_eq!(find_program(&s, &dir, None), dir.join("python").join("python.exe"));
        s.program.insert(0, "{engine}\\other\\python.exe".into());
        std::fs::write(dir.join("python").join("python.exe"), "").unwrap();
        assert_eq!(find_program(&s, &dir, None), dir.join("python").join("python.exe"));
        assert_eq!(find_program(&s, &dir, Some("/usr/bin/python3")), PathBuf::from("/usr/bin/python3"));
    }

    // a stand-in program: answers each line with the mark, skipping a banner first; "silent"
    // makes it say nothing for a minute
    #[cfg(unix)]
    fn fake_engine(folder: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("engines.json"),
            serde_json::json!({ "engines": [spec(&dir.join("fake").to_string_lossy())] }).to_string(),
        )
        .unwrap();
        let fake = dir.join("fake");
        std::fs::write(&fake, "#!/bin/sh\necho 'Fake banner'\nwhile read line; do\n  case \"$line\" in\n    *Get*) echo '@@OPENSW@@ready' ;;\n    *quit*) exit 0 ;;\n    *silent*) exec sleep 60 ;;\n    *) echo 'a message'; echo '\"@@OPENSW@@eyJvayI6MX0=\"' ;;\n  esac\ndone\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        dir
    }

    // the tests that run a program share RUNNING, and stop() stops every program: one at a time
    #[cfg(unix)]
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    #[cfg(unix)]
    #[test]
    fn compute_should_read_the_marked_line_and_restart_a_stopped_engine() {
        let _alone = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let dir = fake_engine("opensw-fake-engine");
        let ok = |started| Answer { data: "eyJvayI6MX0=".into(), started };
        assert_eq!(compute(&dir, "fake", None, "factor", "eA==").unwrap(), ok(true));
        assert_eq!(compute(&dir, "fake", None, "factor", "eA==").unwrap(), ok(false));
        assert!(compute(&dir, "fake", None, "quit", "eA==").is_err()); // the program stops
        assert_eq!(compute(&dir, "fake", None, "factor", "eA==").unwrap(), ok(true)); // started again
        assert!(compute(&dir, "other", None, "factor", "eA==").is_err());
        stop();
    }

    // as the Python that comes with opensw: found in the engine folder, loads the adapter
    // from its arguments and says ready itself, each line in is "<op> <data>"
    #[cfg(unix)]
    #[test]
    fn a_program_in_the_engine_folder_should_answer_and_a_missing_one_fail_to_start() {
        let _alone = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("opensw-own-engine");
        std::fs::create_dir_all(dir.join("python")).unwrap();
        let own = serde_json::json!({ "engines": [{
            "id": "python", "name": "SymPy", "program": ["{engine}/python/python.exe"], "args": ["{adapter}"],
            "adapter": "opensw_stdio.py", "call": "{op} {data}"
        }] });
        std::fs::write(dir.join("engines.json"), own.to_string()).unwrap();
        let program = dir.join("python").join("python.exe");
        let _ = std::fs::remove_file(&program);
        let error = compute(&dir, "python", None, "factor", "eA==").unwrap_err();
        assert!(error.starts_with("Cannot find SymPy (") && error.contains("python.exe"), "{error}");
        std::fs::write(&program, "#!/bin/sh\ncase \"$1\" in *opensw_stdio.py) echo '@@OPENSW@@ready' ;; esac\nwhile read op data; do echo \"@@OPENSW@@$data\"; done\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(compute(&dir, "python", None, "factor", "eA==").unwrap(), Answer { data: "eA==".into(), started: true });
        assert_eq!(compute(&dir, "python", None, "expand", "eQ==").unwrap(), Answer { data: "eQ==".into(), started: false });
        stop();
    }

    #[cfg(unix)]
    #[test]
    fn an_engine_that_does_not_answer_should_be_stopped_and_start_again() {
        let _alone = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let dir = fake_engine("opensw-silent-engine");
        let ok = |started| Answer { data: "eyJvayI6MX0=".into(), started };
        assert_eq!(compute(&dir, "fake", None, "factor", "eA==").unwrap(), ok(true));
        let asked = Instant::now();
        let error = compute(&dir, "fake", None, "silent", "eA==").unwrap_err();
        assert!(error.contains("did not answer within 2 seconds"), "{error}");
        assert!(asked.elapsed() < Duration::from_secs(10));
        assert!(CHILDREN.lock().unwrap().is_empty()); // the silent program is not left running
        assert_eq!(compute(&dir, "fake", None, "factor", "eA==").unwrap(), ok(true)); // started again
        stop();
    }

    #[cfg(unix)]
    #[test]
    fn stop_should_not_wait_for_a_computation_that_is_still_waiting() {
        let _alone = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let dir = fake_engine("opensw-closing-engine");
        compute(&dir, "fake", None, "factor", "eA==").unwrap();
        let waiting = std::thread::spawn(move || compute(&dir, "fake", None, "silent", "eA=="));
        std::thread::sleep(Duration::from_millis(300)); // the computation now holds RUNNING
        let closing = Instant::now();
        stop();
        let error = waiting.join().unwrap().unwrap_err();
        assert!(closing.elapsed() < Duration::from_secs(1), "{:?}", closing.elapsed());
        assert!(error.contains("stopped (no answer)"), "{error}");
    }
}
