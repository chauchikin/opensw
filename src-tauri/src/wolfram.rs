//! Tools > Computation Engine > Mathematica: the Compute menu done by a Wolfram kernel on
//! this computer. One console kernel (wolfram.exe -noprompt) is kept running, so only the
//! first computation waits for it to start. The kernel loads engine/opensw_compute.wl; each
//! computation is one line in and one line out, both base64 so no console code page can
//! garble them (see the top of opensw_compute.wl).

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

const PACKAGE: &str = include_str!("../../engine/opensw_compute.wl");
const MARK: &str = "@@OPENSW@@";

struct Kernel {
    path: PathBuf,
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Drop for Kernel {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static KERNEL: Mutex<Option<Kernel>> = Mutex::new(None);

/// The console kernel: the one the user chose, otherwise the newest one installed in the
/// usual place, otherwise `wolfram` on the PATH.
fn find_kernel(chosen: Option<&str>) -> PathBuf {
    if let Some(p) = chosen.map(str::trim).filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    if cfg!(windows) {
        let mut found: Vec<(Vec<u32>, PathBuf)> = Vec::new();
        for product in ["Wolfram", "Mathematica", "Wolfram Engine"] {
            let Ok(dirs) = std::fs::read_dir(PathBuf::from(r"C:\Program Files\Wolfram Research").join(product)) else { continue };
            for dir in dirs.flatten() {
                let version: Vec<u32> = dir.file_name().to_string_lossy().split('.').map_while(|n| n.parse().ok()).collect();
                // wolfram.exe since 13; math.exe in older versions
                if let Some(exe) = ["wolfram.exe", "math.exe"].iter().map(|e| dir.path().join(e)).find(|p| p.is_file()) {
                    found.push((version, exe));
                }
            }
        }
        if let Some((_, exe)) = found.into_iter().max_by(|a, b| a.0.cmp(&b.0)) {
            return exe;
        }
    } else if cfg!(target_os = "macos") {
        for app in ["Wolfram", "Mathematica", "Wolfram Engine"] {
            let exe = PathBuf::from(format!("/Applications/{app}.app/Contents/MacOS/WolframKernel"));
            if exe.is_file() {
                return exe;
            }
        }
    }
    PathBuf::from("wolfram")
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

impl Kernel {
    fn start(path: PathBuf) -> Result<Kernel, String> {
        let mut cmd = Command::new(&path);
        cmd.arg("-noprompt").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("找不到 Mathematica（{}）：{e}。可以在 工具 > 計算引擎 指定 wolfram.exe 的位置", path.display()))?;
        let input = child.stdin.take().ok_or("Mathematica 沒有輸入管道")?;
        let output = BufReader::new(child.stdout.take().ok_or("Mathematica 沒有輸出管道")?);
        let mut kernel = Kernel { path, child, input, output };
        let file = std::env::temp_dir().join("opensw_compute.wl");
        std::fs::write(&file, PACKAGE).map_err(|e| e.to_string())?;
        let name = base64(file.to_string_lossy().as_bytes());
        // the file is UTF-8 (the kernel would read it in the system's code page, e.g. CP950)
        let ready = kernel.send(&format!(
            "Get[ByteArrayToString[BaseDecode[\"{name}\"], \"UTF-8\"], CharacterEncoding -> \"UTF-8\"]; \
             WriteString[\"stdout\", \"{MARK}\" <> If[DownValues[OpenSW`OpenSWCompute] === {{}}, \"failed\", \"ready\"] <> \"\\n\"]"
        ))?;
        if ready != "ready" {
            return Err(format!("Mathematica 載入 opensw 引擎失敗：{ready}"));
        }
        Ok(kernel)
    }

    /// One line in; the text after the mark on the first line that has it.
    /// Other lines (a start-up banner, messages) are skipped.
    fn send(&mut self, line: &str) -> Result<String, String> {
        let gone = |e: String| format!("Mathematica 停止了（{e}），下次計算會重新啟動");
        writeln!(self.input, "{line}").and_then(|_| self.input.flush()).map_err(|e| gone(e.to_string()))?;
        let mut text = String::new();
        loop {
            text.clear();
            if self.output.read_line(&mut text).map_err(|e| gone(e.to_string()))? == 0 {
                return Err(gone("沒有回應".into()));
            }
            if let Some(i) = text.find(MARK) {
                return Ok(text[i + MARK.len()..].trim_end_matches(|c: char| c.is_whitespace() || c == '"').to_string());
            }
        }
    }
}

/// One computation: op (a word like "factor") and the MathJSON text as base64
/// -> the JSON answer as base64. The kernel is started on first use (or again after
/// it stopped, or when the user chose another one).
pub fn compute(kernel: Option<&str>, op: &str, data: &str) -> Result<String, String> {
    if op.is_empty() || !op.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') || !is_base64(data) {
        return Err("計算指令格式不對".into());
    }
    let path = find_kernel(kernel);
    let mut slot = KERNEL.lock().map_err(|e| e.to_string())?;
    if slot.as_ref().is_some_and(|k| k.path != path) {
        *slot = None; // another kernel was chosen
    }
    if slot.is_none() {
        *slot = Some(Kernel::start(path)?);
    }
    let answer = slot.as_mut().map(|k| k.send(&format!("OpenSW`OpenSWCompute[\"{op}\", \"{data}\"]")));
    match answer {
        Some(Ok(a)) if is_base64(&a) => Ok(a),
        Some(Ok(a)) => Err(format!("Mathematica 回了看不懂的內容：{a}")),
        Some(Err(e)) => {
            *slot = None;
            Err(e)
        }
        None => unreachable!("the kernel was just started"),
    }
}

/// Stops the kernel when the editor closes.
pub fn stop() {
    if let Ok(mut slot) = KERNEL.lock() {
        *slot = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_should_match_the_standard_alphabet() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64("C:\\使用者\\a.wl".as_bytes()), "Qzpc5L2/55So6ICFXGEud2w=");
    }

    #[test]
    fn compute_should_refuse_odd_input() {
        assert!(compute(Some("/nonexistent"), "fac tor", "eA==").is_err());
        assert!(compute(Some("/nonexistent"), "factor", "x\"]; Run[\"rm\"]").is_err());
    }

    #[test]
    fn find_kernel_should_use_the_chosen_path() {
        assert_eq!(find_kernel(Some(" /opt/w/wolfram ")), PathBuf::from("/opt/w/wolfram"));
    }

    // a stand-in kernel: answers each line with the mark, skipping a banner first
    #[cfg(unix)]
    #[test]
    fn compute_should_read_the_marked_line_and_restart_a_stopped_kernel() {
        let dir = std::env::temp_dir().join("opensw-fake-kernel");
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("wolfram");
        std::fs::write(&fake, "#!/bin/sh\necho 'Wolfram banner'\nwhile read line; do\n  case \"$line\" in\n    *Get*) echo '@@OPENSW@@ready' ;;\n    *quit*) exit 0 ;;\n    *) echo 'a message'; echo '\"@@OPENSW@@eyJvayI6MX0=\"' ;;\n  esac\ndone\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = fake.to_str().unwrap();
        assert_eq!(compute(Some(path), "factor", "eA==").unwrap(), "eyJvayI6MX0=");
        assert!(compute(Some(path), "quit", "eA==").is_err()); // the kernel stops
        assert_eq!(compute(Some(path), "factor", "eA==").unwrap(), "eyJvayI6MX0="); // started again
        stop();
    }
}
