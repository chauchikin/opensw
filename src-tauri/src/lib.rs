//! Desktop shell for opensw: file access and typesetting for the web editor,
//! and the control channel AI agents use (remote.rs, mcp.rs).

pub mod mcp;
mod remote;
mod wolfram;

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// Reads a file the user picked in a file dialog.
#[tauri::command]
fn read_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("讀不到 {path}：{e}"))
}

/// Writes a file the user picked in a save dialog.
#[tauri::command]
fn write_file(path: &str, data: Vec<u8>) -> Result<(), String> {
    // pictures saved with an exported .tex may go in a folder of their own (graphics/)
    if let Some(parent) = Path::new(path).parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|e| format!("建不了資料夾 {}：{e}", parent.display()))?;
    }
    std::fs::write(path, data).map_err(|e| format!("寫不進 {path}：{e}"))
}

/// The document the app was started with (double-clicking a .sci, or "opensw file.sci").
#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with("--"))
        .find(|a| {
            let p = Path::new(a);
            p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("sci") || e.eq_ignore_ascii_case("tex"))
        })
}

/// A file the TeX run needs next to the .tex (a picture), named relative to it.
#[derive(serde::Deserialize)]
struct TexFile {
    name: String,
    data: Vec<u8>,
}

/// `name` as a path inside `dir`, or None when it would leave it (absolute, "..", a drive)
fn inside(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut out = dir.to_path_buf();
    for part in name.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

/// Typesets LaTeX to PDF and opens the PDF in the system viewer.
/// Uses xelatex when it is installed, otherwise the bundled Tectonic engine.
#[tauri::command]
async fn typeset(app: tauri::AppHandle, tex: String, name: String, files: Option<Vec<TexFile>>) -> Result<String, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("typeset");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = safe_stem(&name);
    let tex_path = dir.join(format!("{stem}.tex"));
    // a Scientific Word 5.x document loads 5.x's macro files (\input{tcilatex}): put them next to it
    if tex.contains("\\input{tcilatex}")
        && let Ok(res) = app.path().resource_dir()
    {
        copy_macro_files(&res.join("tex55"), &dir)?;
        // the originals from the user's own Scientific Word 5.x win over the bundled copies
        for folder in installed_sw5_macro_folders() {
            copy_macro_files(&folder, &dir)?;
        }
    }
    std::fs::write(&tex_path, tex).map_err(|e| e.to_string())?;
    for f in files.unwrap_or_default() {
        let Some(target) = inside(&dir, &f.name) else { continue };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, f.data).map_err(|e| e.to_string())?;
    }

    // Running a TeX engine takes seconds: keep it off the UI thread.
    let tectonic = bundled_tectonic(&app);
    let tex_cache = bundled_tex_cache(&app);
    let pdf = tauri::async_runtime::spawn_blocking(move || run_engine(&dir, &stem, tectonic.as_deref(), tex_cache.as_deref()))
        .await
        .map_err(|e| e.to_string())??;

    app.opener()
        .open_path(pdf.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("PDF 已產生（{}），但打不開：{e}", pdf.display()))?;
    Ok(pdf.to_string_lossy().into_owned())
}

/// File > Open Location: the bytes at a web address. curl (part of Windows 10 and later,
/// macOS and Linux) fetches it, so a site's cross-origin rules do not stop the page.
#[tauri::command]
async fn fetch_url(url: String) -> Result<Vec<u8>, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("網址要以 http:// 或 https:// 開頭".into());
    }
    let mut cmd = Command::new("curl");
    cmd.args(["-fsSL", "--max-time", "60", "--", &url]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = tauri::async_runtime::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("執行不了 curl：{e}"))?;
    if !out.status.success() {
        return Err(format!("下載失敗：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

/// Compute > Check with Lean: checks a Lean 4 file in the Lean project the user chose
/// (a Lake project with Mathlib), with `lake env lean`. -> (no errors, Lean's output)
#[tauri::command]
async fn lean_check(app: tauri::AppHandle, project: String, code: String) -> Result<(bool, String), String> {
    let project = PathBuf::from(project);
    if !project.join("lakefile.toml").is_file() && !project.join("lakefile.lean").is_file() {
        return Err(format!("{} 不是 Lean 專案（裡面沒有 lakefile）", project.display()));
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("lean");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("OpenswCheck.lean");
    std::fs::write(&file, code).map_err(|e| e.to_string())?;
    let lake = find_lake(&project).ok_or("找不到 Lean 的 lake（裝在 elan 裡的那個）")?;
    let mut cmd = Command::new(&lake);
    cmd.args(["env", "lean"]).arg(&file).current_dir(&project);
    // lake is elan's stand-in program: it finds Lean through ELAN_HOME (the folder above bin)
    if let Some(home) = lake.parent().and_then(Path::parent) {
        cmd.env("ELAN_HOME", home);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window pops up
    }
    // the first check after starting loads Mathlib, which takes a while
    let out = tauri::async_runtime::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Lean 執行失敗：{e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
    Ok((out.status.success(), text))
}

/// Tools > Computation Engine > Mathematica: one computation by the Wolfram kernel
/// (wolfram.rs). data and the answer are base64 (the MathJSON text / the JSON answer).
#[tauri::command]
async fn wolfram_compute(kernel: Option<String>, op: String, data: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wolfram::compute(kernel.as_deref(), &op, &data))
        .await
        .map_err(|e| e.to_string())?
}

/// lake from elan: $ELAN_HOME, ~/.elan, or an elan folder next to the project or above it
fn find_lake(project: &Path) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "lake.exe" } else { "lake" };
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let mut homes: Vec<PathBuf> = std::env::var_os("ELAN_HOME").map(PathBuf::from).into_iter().collect();
    homes.extend(home.map(|h| h.join(".elan")));
    homes.extend(project.ancestors().skip(1).take(2).map(|p| p.join("elan")));
    homes.into_iter().map(|h| h.join("bin").join(exe)).find(|p| p.is_file())
}

/// Macro folders of a Scientific Word / WorkPlace 5.x installation, if there is one.
fn installed_sw5_macro_folders() -> Vec<PathBuf> {
    const ROOTS: [&str; 8] = [r"C:\sw55", r"C:\swp55", r"C:\sn55", r"C:\sw50", r"C:\swp50", r"C:\sw40", r"C:\swp40", r"C:\swp35"];
    const SUBDIRS: [&str; 3] = [r"TCITeX\TeX\LaTeX\SWmacros", r"TCITeX\TeX\LaTeX\SWmisc", r"TCITeX\TeX\latex209\contrib\jeep"];
    ROOTS
        .iter()
        .flat_map(|root| SUBDIRS.iter().map(move |sub| Path::new(root).join(sub)))
        .filter(|p| p.is_dir())
        .collect()
}

/// Copies the bundled Scientific Word 5.x macro files (a flat folder) into `to`.
fn copy_macro_files(from: &Path, to: &Path) -> Result<(), String> {
    let Ok(entries) = std::fs::read_dir(from) else { return Ok(()) }; // not bundled (development build)
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            std::fs::copy(&path, to.join(entry.file_name())).map_err(|e| format!("複製 {} 失敗：{e}", path.display()))?;
        }
    }
    Ok(())
}

/// File names from documents can contain anything; TeX engines on Windows only
/// handle plain ASCII names reliably.
fn safe_stem(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if s.is_empty() { "document".to_string() } else { s }
}

fn bundled_tectonic(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "tectonic.exe" } else { "tectonic" };
    let path = app.path().resource_dir().ok()?.join("bin").join(exe);
    path.exists().then_some(path)
}

/// The TeX files Tectonic needs for opensw's documents, put in at build time
/// (src-tauri/texwarm): typesetting works without the internet.
fn bundled_tex_cache(app: &tauri::AppHandle) -> Option<PathBuf> {
    let path = app.path().resource_dir().ok()?.join("texcache");
    path.is_dir().then_some(path)
}

/// A command for a console program (xelatex, Tectonic...) that opens no console window on Windows.
fn hidden(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn run_engine(dir: &Path, stem: &str, tectonic: Option<&Path>, tex_cache: Option<&Path>) -> Result<PathBuf, String> {
    let tex_file = format!("{stem}.tex");
    let pdf = dir.join(format!("{stem}.pdf"));
    let _ = std::fs::remove_file(&pdf);

    let xelatex = || {
        hidden("xelatex")
            // like Scientific Word 5.5: an error is reported in the log but the PDF still
            // comes out (teachers' 5.5 files often carry an old harmless error)
            .args(["-interaction=nonstopmode", &tex_file])
            .current_dir(dir)
            .output()
    };
    let output = match xelatex() {
        Ok(out) => finish_xelatex(dir, stem, out, xelatex),
        Err(_) => {
            let Some(tectonic) = tectonic else {
                return Err("找不到排版程式（xelatex 或內附的 Tectonic）。".to_string());
            };
            // The bundled cache has what opensw's documents need; anything else is downloaded
            // (internet) the first time and kept in the same cache.
            let mut cmd = hidden(tectonic);
            cmd.args(["--keep-logs", "-Z", "continue-on-errors", &tex_file]).current_dir(dir);
            if let Some(cache) = tex_cache {
                cmd.env("TECTONIC_CACHE_DIR", cache);
            }
            cmd.output()
                .map_err(|e| format!("Tectonic 執行失敗：{e}"))?
        }
    };

    if pdf.exists() {
        return Ok(pdf);
    }
    let log = String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
    let tail: String = log.lines().rev().take(15).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    Err(format!("排版失敗：\n{tail}"))
}

/// After a first xelatex run: BibTeX and makeindex when the document uses them, then
/// xelatex again (at most twice) until cross-references and citations settle.
/// Tectonic does all of this by itself.
fn finish_xelatex(
    dir: &Path,
    stem: &str,
    first: std::process::Output,
    xelatex: impl Fn() -> std::io::Result<std::process::Output>,
) -> std::process::Output {
    if !dir.join(format!("{stem}.pdf")).exists() {
        return first;
    }
    let aux = std::fs::read_to_string(dir.join(format!("{stem}.aux"))).unwrap_or_default();
    let mut tools_ran = false;
    if aux.contains("\\bibdata") {
        // a missing bibtex leaves the citations as [?]; the PDF still comes out
        tools_ran |= hidden("bibtex").arg(stem).current_dir(dir).output().is_ok();
    }
    let idx = dir.join(format!("{stem}.idx"));
    if idx.exists() {
        tools_ran |= hidden("makeindex").arg(format!("{stem}.idx")).current_dir(dir).output().is_ok();
    }
    let mut last = first;
    for _ in 0..2 {
        let log = String::from_utf8_lossy(&last.stdout);
        let unsettled = log.contains("Rerun to get") || log.contains("undefined references") || log.contains("Label(s) may have changed");
        if !unsettled && !tools_ran {
            break;
        }
        tools_ran = false;
        match xelatex() {
            Ok(out) => last = out,
            Err(_) => break,
        }
    }
    last
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// The app's identifier (tauri.conf.json): the name of its folders in AppData.
pub const IDENTIFIER: &str = "org.opensw.editor";
/// The identifier up to 0.5.0. Its folders hold the settings, fragments and last document
/// (the page's storage), so the first start under the new name moves them over.
const OLD_IDENTIFIER: &str = "com.ckwinlose.swnext";

fn move_old_folders() {
    for var in ["APPDATA", "LOCALAPPDATA"] {
        let Some(base) = std::env::var_os(var).map(PathBuf::from) else { continue };
        let (old, new) = (base.join(OLD_IDENTIFIER), base.join(IDENTIFIER));
        if old.is_dir() && !new.exists() && std::fs::rename(&old, &new).is_err() {
            copy_folder(&old, &new); // in use: copy instead, the old one stays
        }
    }
}

/// Copies what it can: a file still locked by an old process is left out, the rest still comes.
fn copy_folder(from: &Path, to: &Path) {
    let _ = std::fs::create_dir_all(to);
    let Ok(entries) = std::fs::read_dir(from) else { return };
    for entry in entries.flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            copy_folder(&entry.path(), &target);
        } else {
            let _ = std::fs::copy(entry.path(), target);
        }
    }
}

pub fn run() {
    move_old_folders();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // without the control channel the editor still works; agents just cannot connect
            if let Err(e) = remote::start(app.handle()) {
                eprintln!("opensw: control channel not started: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, typeset, startup_path, lean_check, fetch_url, wolfram_compute, remote::api_reply, remote::api_ready])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| panic!("opensw could not start: {e}"))
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                remote::stop();
                wolfram::stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{Path, copy_macro_files, inside, run_engine, safe_stem};

    #[test]
    fn safe_stem_should_replace_spaces_and_dots() {
        assert_eq!(safe_stem("my doc.v2"), "my_doc_v2");
    }

    #[test]
    fn safe_stem_should_replace_chinese_letters() {
        assert_eq!(safe_stem("hw1 數值"), "hw1___");
    }

    #[test]
    fn copy_macro_files_should_copy_every_file() {
        let base = std::env::temp_dir().join(format!("opensw-test-{}", std::process::id()));
        let (from, to) = (base.join("from"), base.join("to"));
        std::fs::create_dir_all(&from).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("tcilatex.tex"), "x").unwrap();
        copy_macro_files(&from, &to).unwrap();
        assert!(to.join("tcilatex.tex").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn copy_macro_files_should_ignore_a_missing_folder() {
        assert!(copy_macro_files(std::path::Path::new("/no/such/folder"), &std::env::temp_dir()).is_ok());
    }

    #[test]
    fn safe_stem_should_fall_back_when_empty() {
        assert_eq!(safe_stem(""), "document");
    }

    #[test]
    fn run_engine_should_settle_references_with_xelatex() {
        // needs xelatex and pdftotext installed; skipped otherwise
        if std::process::Command::new("xelatex").arg("--version").output().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join("opensw-run-engine-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("r.tex"), "\\documentclass{article}\\begin{document}\\section{A}\\label{a}See \\ref{a}.\\end{document}\n").unwrap();
        let pdf = run_engine(&dir, "r", None, None).expect("typeset");
        let text = std::process::Command::new("pdftotext").arg(&pdf).arg("-").output().unwrap();
        assert!(String::from_utf8_lossy(&text.stdout).contains("See 1."));
    }

    #[test]
    fn inside_should_keep_relative_names_in_the_folder() {
        let dir = Path::new("/tmp/typeset");
        assert_eq!(inside(dir, "graphics/pic.png"), Some(dir.join("graphics").join("pic.png")));
    }

    #[test]
    fn inside_should_refuse_names_that_leave_the_folder() {
        let dir = Path::new("/tmp/typeset");
        for bad in ["../x.png", "/etc/x", "a//b", "C:/x.png", "a\\..\\b", ""] {
            assert_eq!(inside(dir, bad), None, "{bad}");
        }
    }
}
