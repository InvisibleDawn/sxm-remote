// Copyright © 2026 Invisible_Dawn
// SPDX-License-Identifier: GPL-3.0-or-later
// SXM Remote — client Bureau à distance (RDP), moteur FreeRDP
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

const GITHUB_REPO: &str = "InvisibleDawn/sxm-remote";
const KEYRING_SERVICE: &str = "SXM Remote";

/* ---------- fichiers de configuration ---------- */

/// ~/.config/sxm-rdp sous Linux (identique à la v1), ~/Library/Application Support/sxm-rdp sous macOS.
fn conf_dir() -> Result<PathBuf, String> {
    let d = dirs::config_dir().ok_or("Dossier de configuration introuvable.")?.join("sxm-rdp");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn read_json(name: &str, default: Value) -> Value {
    conf_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(name)).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(default)
}

fn write_json(name: &str, v: &Value) -> Result<(), String> {
    let path = conf_dir()?.join(name);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_connections() -> Value {
    read_json("connections.json", json!([]))
}

#[tauri::command]
fn save_connections(conns: Value) -> Result<(), String> {
    if !conns.is_array() {
        return Err("Format invalide.".into());
    }
    write_json("connections.json", &conns)
}

#[tauri::command]
fn load_settings() -> Value {
    read_json("settings.json", json!({}))
}

#[tauri::command]
fn save_settings(settings: Value) -> Result<(), String> {
    write_json("settings.json", &settings)
}

/* ---------- trousseau (GNOME Keyring / Trousseau macOS) ---------- */

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    if !valid_id(id) {
        return Err("Identifiant invalide.".into());
    }
    keyring::Entry::new(KEYRING_SERVICE, id).map_err(|e| e.to_string())
}

/// Mot de passe enregistré par la v1 (Python, schéma com.sxm.rdp) : récupéré une fois puis migré.
#[cfg(target_os = "linux")]
async fn legacy_password(id: &str) -> Option<String> {
    let out = Command::new("secret-tool").args(["lookup", "id", id]).output().await.ok()?;
    let pw = String::from_utf8_lossy(&out.stdout).to_string();
    (out.status.success() && !pw.is_empty()).then_some(pw)
}

#[tauri::command]
async fn pw_get(id: String) -> Result<Option<String>, String> {
    let e = entry(&id)?;
    match e.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => {
            #[cfg(target_os = "linux")]
            if let Some(p) = legacy_password(&id).await {
                let _ = e.set_password(&p);
                return Ok(Some(p));
            }
            Ok(None)
        }
        Err(err) => Err(format!("Trousseau indisponible : {err}")),
    }
}

#[tauri::command]
fn pw_set(id: String, password: String) -> Result<(), String> {
    let e = entry(&id)?;
    if password.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(&password).map_err(|e| format!("Trousseau indisponible : {e}"))
}

/* ---------- outils externes ---------- */

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // Les applis lancées depuis le Finder n'ont pas Homebrew dans leur PATH.
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let p = PathBuf::from(extra);
        if !dirs.contains(&p) {
            dirs.push(p);
        }
    }
    dirs
}

fn which(names: &[&str]) -> Option<PathBuf> {
    for name in names {
        for d in search_dirs() {
            let p = d.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn freerdp() -> Option<PathBuf> {
    // macOS : le client SDL fonctionne sans XQuartz. Linux : le client X11, éprouvé sous MATE.
    #[cfg(target_os = "macos")]
    let names = ["sdl-freerdp3", "sdl-freerdp", "xfreerdp3", "xfreerdp"];
    #[cfg(not(target_os = "macos"))]
    let names = ["xfreerdp3", "xfreerdp", "sdl-freerdp3", "sdl-freerdp"];
    which(&names)
}

fn tailscale() -> Option<PathBuf> {
    let app = PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    which(&["tailscale"]).or_else(|| app.is_file().then_some(app))
}

#[derive(Serialize)]
struct Engine {
    path: Option<String>,
    version: Option<String>,
}

#[tauri::command]
async fn engine() -> Engine {
    let Some(p) = freerdp() else { return Engine { path: None, version: None } };
    let version = Command::new(&p).arg("--version").output().await.ok().and_then(|o| {
        let s = String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr);
        s.split_whitespace()
            .skip_while(|w| *w != "version")
            .nth(1)
            .map(String::from)
    });
    Engine { path: Some(p.display().to_string()), version }
}

#[derive(Serialize)]
struct Peer {
    name: String,
    ip: String,
    online: bool,
}

#[tauri::command]
async fn tailscale_peers() -> Vec<Peer> {
    let Some(ts) = tailscale() else { return vec![] };
    let Ok(Ok(out)) = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        Command::new(ts).args(["status", "--json"]).output(),
    )
    .await
    else {
        return vec![];
    };
    let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) else { return vec![] };
    let mut peers: Vec<Peer> = v
        .get("Peer")
        .and_then(|p| p.as_object())
        .map(|m| {
            m.values()
                .filter_map(|p| {
                    let ip = p.get("TailscaleIPs")?.as_array()?.first()?.as_str()?.to_string();
                    Some(Peer {
                        name: p.get("HostName").and_then(|h| h.as_str()).unwrap_or("?").to_string(),
                        ip,
                        online: p.get("Online").and_then(|o| o.as_bool()).unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    peers.sort_by(|a, b| b.online.cmp(&a.online).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    peers
}

/* ---------- connexion RDP ---------- */

fn flag(c: &Value, k: &str, default: bool) -> bool {
    c.get(k).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn text(c: &Value, k: &str) -> String {
    c.get(k).and_then(|v| v.as_str()).unwrap_or_default().trim().to_string()
}

fn valid_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 255
        && h.chars().all(|c| c.is_ascii_alphanumeric() || ".-:[]_".contains(c))
}

#[derive(Serialize, Clone)]
struct RdpExit {
    id: String,
    /// "ok" | "auth" | "unreachable" | "error"
    kind: String,
    detail: String,
}

#[tauri::command]
async fn connect(app: AppHandle, conn: Value, password: String) -> Result<(), String> {
    let exe = freerdp().ok_or("FreeRDP n'est pas installé.")?;
    let host = text(&conn, "host");
    if !valid_host(&host) {
        return Err("Adresse IP invalide.".into());
    }
    let id = text(&conn, "id");
    let name = text(&conn, "name");
    let mut user = text(&conn, "user");
    let mut domain = None;
    if let Some((d, u)) = user.clone().split_once('\\') {
        domain = Some(d.to_string());
        user = u.to_string();
    }

    let mut args = vec![
        format!("/v:{host}"),
        format!("/u:{user}"),
        format!("/p:{password}"),
        format!("/t:{}", if name.is_empty() { &host } else { &name }),
        "/dynamic-resolution".into(),
        "/gfx".into(),
        "+auto-reconnect".into(),
        "/cert:ignore".into(),
    ];
    if let Some(d) = domain {
        args.push(format!("/d:{d}"));
    }
    args.push(if flag(&conn, "fullscreen", true) { "/f".into() } else { "/size:1600x900".into() });
    if flag(&conn, "multimon", false) {
        args.push("/multimon".into());
    }
    if flag(&conn, "clipboard", true) {
        args.push("+clipboard".into());
    }
    if flag(&conn, "sound", true) {
        args.push("/sound".into());
    }
    if flag(&conn, "drive", false) {
        if let Some(home) = dirs::home_dir() {
            args.push(format!("/drive:Partage,{}", home.display()));
        }
    }

    let child = Command::new(&exe)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer FreeRDP : {e}"))?;

    tauri::async_runtime::spawn(async move {
        let (kind, detail) = match child.wait_with_output().await {
            Ok(out) => {
                let code = out.status.code().unwrap_or(0);
                let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
                let kind = if [0, 1, 11, 12, 255].contains(&code) && !err.contains("logon_failure") {
                    "ok"
                } else if err.contains("logon_failure") || err.contains("authentication") {
                    "auth"
                } else if err.contains("connect_failed")
                    || err.contains("unreachable")
                    || err.contains("timed out")
                    || err.contains("dns")
                    || err.contains("connection refused")
                {
                    "unreachable"
                } else {
                    "error"
                };
                (kind.to_string(), format!("code {code}"))
            }
            Err(e) => ("error".to_string(), e.to_string()),
        };
        let _ = app.emit("rdp-exit", RdpExit { id, kind, detail });
    });
    Ok(())
}

/* ---------- mises à jour (Releases GitHub) ---------- */

#[derive(Serialize)]
struct Release {
    version: String,
    url: Option<String>,
    notes: String,
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("SXM-Remote/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_update() -> Result<Release, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let v: Value = http()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let assets: Vec<String> = v
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.get("browser_download_url")?.as_str().map(String::from)).collect())
        .unwrap_or_default();
    #[cfg(target_os = "macos")]
    let pick = assets.iter().find(|u| u.ends_with(".dmg"));
    #[cfg(not(target_os = "macos"))]
    let pick = assets
        .iter()
        .find(|u| u.ends_with(".x86_64.rpm"))
        .or_else(|| assets.iter().find(|u| u.ends_with(".rpm")));
    Ok(Release {
        version: v.get("tag_name").and_then(|t| t.as_str()).unwrap_or("0").trim_start_matches(['v', 'V']).to_string(),
        url: pick.cloned(),
        notes: v.get("body").and_then(|b| b.as_str()).unwrap_or_default().to_string(),
    })
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" } else { "linux" }
}

/// Télécharge la nouvelle version puis l'installe (Fedora) ou ouvre le .dmg (macOS).
/// Renvoie "installed" (il faut redémarrer) ou "opened" (l'utilisateur glisse l'appli).
#[tauri::command]
async fn install_update(url: String) -> Result<String, String> {
    let prefix = format!("https://github.com/{GITHUB_REPO}/releases/download/");
    if !url.starts_with(&prefix) || url.contains("..") {
        return Err("Adresse de mise à jour non autorisée.".into());
    }
    let file = url.rsplit('/').next().unwrap_or("sxm-remote-update").to_string();
    let dir = if cfg!(target_os = "macos") {
        dirs::download_dir().or_else(dirs::home_dir).ok_or("Dossier Téléchargements introuvable.")?
    } else {
        dirs::cache_dir().ok_or("Dossier cache introuvable.")?.join("sxm-remote")
    };
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let dest = dir.join(&file);

    let bytes = http()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Téléchargement impossible : {e}"))?
        .error_for_status()
        .map_err(|e| format!("Téléchargement impossible : {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(&dest, &bytes).await.map_err(|e| e.to_string())?;

    if cfg!(target_os = "macos") {
        Command::new("open").arg(&dest).status().await.map_err(|e| e.to_string())?;
        return Ok("opened".into());
    }
    let out = Command::new("pkexec")
        .args(["dnf", "install", "-y"])
        .arg(&dest)
        .output()
        .await
        .map_err(|e| format!("pkexec introuvable : {e}"))?;
    match out.status.code() {
        Some(0) => Ok("installed".into()),
        Some(126) | Some(127) => Err("cancelled".into()),
        _ => {
            let msg = String::from_utf8_lossy(&out.stderr);
            Err(msg.chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect())
        }
    }
}

#[tauri::command]
fn restart(app: AppHandle) {
    app.restart();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_connections, save_connections, load_settings, save_settings,
            pw_get, pw_set, engine, tailscale_peers, connect,
            check_update, install_update, app_version, platform, restart
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SXM Remote");
}
