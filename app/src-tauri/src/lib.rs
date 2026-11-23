use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{ipc::{InvokeBody, Request, Response}, AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct Progress {
    frac: f64,
    msg: String,
}

/// Directory containing the Python engine (`engine/`). Override with AUTOBONES_ENGINE.
fn engine_dir() -> PathBuf {
    if let Ok(p) = std::env::var("AUTOBONES_ENGINE") {
        return PathBuf::from(p);
    }
    // Dev layout: <repo>/app/src-tauri -> <repo>/engine
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine"))
}

fn python_exe(engine: &PathBuf) -> PathBuf {
    let venv = if cfg!(windows) {
        engine.join(".venv").join("Scripts").join("python.exe")
    } else {
        engine.join(".venv").join("bin").join("python")
    };
    if venv.is_file() {
        venv
    } else {
        PathBuf::from("python")
    }
}

/// Raw bytes to the webview without JSON-encoding (models can be tens of MB).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Không đọc được {path}: {e}"))
}

/// Raw bytes from the webview. Destination path is sent in the `path` header (percent-encoded).
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .map(|s| urlencoding_decode(s))
        .ok_or("thiếu header path")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("dữ liệu phải ở dạng raw".into());
    };
    if let Some(parent) = PathBuf::from(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, bytes).map_err(|e| format!("Không ghi được {path}: {e}"))
}

fn urlencoding_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn temp_path(name: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("autobones");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' }).collect();
    Ok(dir.join(safe).to_string_lossy().into_owned())
}

/// Run `python -m autobones <args>` and stream `PROGRESS` lines as `engine-progress` events.
/// Returns the JSON after `RESULT`, or an error string from `ERROR`.
#[tauri::command]
async fn run_engine(app: AppHandle, args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = engine_dir();
        let mut cmd = Command::new(python_exe(&engine));
        cmd.arg("-X").arg("utf8").arg("-m").arg("autobones").args(&args)
            .current_dir(&engine)
            .env("PYTHONIOENCODING", "utf-8")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Không chạy được engine Python: {e}"))?;
        let stdout = child.stdout.take().ok_or("không đọc được stdout")?;
        let mut result: Option<String> = None;
        let mut error: Option<String> = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("PROGRESS ") {
                let mut it = rest.splitn(2, ' ');
                let frac = it.next().and_then(|f| f.parse::<f64>().ok()).unwrap_or(0.0);
                let msg = it.next().unwrap_or("").to_string();
                let _ = app.emit("engine-progress", Progress { frac, msg });
            } else if let Some(rest) = line.strip_prefix("RESULT ") {
                result = Some(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("ERROR ") {
                error = Some(rest.to_string());
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if let Some(e) = error {
            return Err(e);
        }
        match (status.success(), result) {
            (true, Some(r)) => Ok(r),
            _ => {
                let mut stderr = String::new();
                if let Some(mut s) = child.stderr.take() {
                    use std::io::Read;
                    let _ = s.read_to_string(&mut stderr);
                }
                let tail: String = stderr.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ");
                Err(format!("Engine kết thúc lỗi ({}): {}", status, tail))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, temp_path, run_engine])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
