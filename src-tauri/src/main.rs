#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FileSystemExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct CleanCategory {
    id: String,
    name: String,
    description: String,
    items: Vec<CleanItem>,
    #[serde(skip)]
    checked: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct CleanItem {
    id: String,
    name: String,
    path: String,
    #[serde(skip)]
    size: u64,
    #[serde(skip)]
    count: usize,
    #[serde(skip)]
    checked: bool,
    is_registry: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ScanResult {
    categories: Vec<CleanCategory>,
    total_size: u64,
    total_count: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct CleanResult {
    freed_bytes: u64,
    freed_count: usize,
    errors: Vec<String>,
}

struct AppState {
    scan_tx: Mutex<Option<mpsc::UnboundedSender<ScanProgress>>>,
    cancel_flag: Arc<Mutex<bool>>,
}

#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    current_category: String,
    progress: f32,
    found_size: u64,
    found_count: usize,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scan_tx: Mutex::new(None),
            cancel_flag: Arc::new(Mutex::new(false)),
        }
    }
}

#[tauri::command]
async fn get_categories() -> Result<Vec<CleanCategory>, String> {
    Ok(build_categories())
}

#[tauri::command]
async fn start_scan(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    selected_categories: Vec<String>,
) -> Result<ScanResult, String> {
    *state.cancel_flag.lock().unwrap() = false;
    let (tx, mut rx) = mpsc::unbounded_channel();
    *state.scan_tx.lock().unwrap() = Some(tx.clone());

    let categories = build_categories()
        .into_iter()
        .filter(|c| selected_categories.contains(&c.id))
        .collect::<Vec<_>>();

    let app_clone = app.clone();
    let cancel_flag = state.cancel_flag.clone();
    let total_categories = categories.len();

    tokio::spawn(async move {
        let mut all_items = Vec::new();
        let mut total_size = 0u64;
        let mut total_count = 0usize;

        for (idx, mut cat) in categories.into_iter().enumerate() {
            if *cancel_flag.lock().unwrap() {
                break;
            }

            let progress = ScanProgress {
                current_category: cat.name.clone(),
                progress: idx as f32 / total_categories as f32,
                found_size: total_size,
                found_count: total_count,
            };
            let _ = tx.send(progress);
            let _ = app_clone.emit("scan-progress", progress);

            for item in &mut cat.items {
                if *cancel_flag.lock().unwrap() {
                    break;
                }
                if let Ok((size, count)) = scan_item(item).await {
                    item.size = size;
                    item.count = count;
                    total_size += size;
                    total_count += count;
                }
            }

            all_items.push(cat);
        }

        let final_progress = ScanProgress {
            current_category: "Concluído".into(),
            progress: 1.0,
            found_size: total_size,
            found_count: total_count,
        };
        let _ = tx.send(final_progress.clone());
        let _ = app_clone.emit("scan-progress", final_progress);

        let result = ScanResult {
            categories: all_items,
            total_size,
            total_count,
        };
        let _ = app_clone.emit("scan-complete", result);
    });

    Ok(ScanResult {
        categories: vec![],
        total_size: 0,
        total_count: 0,
    })
}

#[tauri::command]
async fn cancel_scan(state: State<'_, AppState>) -> Result<(), String> {
    *state.cancel_flag.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
async fn clean_selected(
    app: tauri::AppHandle,
    items: Vec<CleanItem>,
) -> Result<CleanResult, String> {
    let mut freed_bytes = 0u64;
    let mut freed_count = 0usize;
    let mut errors = Vec::new();

    for item in items {
        if !item.checked {
            continue;
        }
        match clean_item(&item).await {
            Ok((bytes, count)) => {
                freed_bytes += bytes;
                freed_count += count;
            }
            Err(e) => errors.push(format!("{}: {}", item.name, e)),
        }
    }

    Ok(CleanResult {
        freed_bytes,
        freed_count,
        errors,
    })
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_startup_items() -> Result<Vec<StartupItem>, String> {
    get_startup_items_impl()
}

#[tauri::command]
async fn toggle_startup_item(path: String, enable: bool) -> Result<(), String> {
    toggle_startup_impl(&path, enable)
}

#[tauri::command]
async fn uninstall_program(name: String) -> Result<(), String> {
    uninstall_program_impl(&name)
}

#[tauri::command]
async fn get_installed_programs() -> Result<Vec<InstalledProgram>, String> {
    get_installed_programs_impl()
}

#[tauri::command]
async fn analyze_disk(path: String) -> Result<DiskAnalysis, String> {
    analyze_disk_impl(&path)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct StartupItem {
    name: String,
    path: String,
    enabled: bool,
    location: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct InstalledProgram {
    name: String,
    version: String,
    publisher: String,
    install_date: String,
    size: String,
    uninstall_string: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DiskAnalysis {
    path: String,
    total_size: u64,
    folders: Vec<FolderSize>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct FolderSize {
    name: String,
    path: String,
    size: u64,
    file_count: usize,
}

async fn scan_item(item: &CleanItem) -> Result<(u64, usize), String> {
    if item.is_registry {
        return Ok((0, 0));
    }
    let path = PathBuf::from(expand_env(&item.path));
    if !path.exists() {
        return Ok((0, 0));
    }
    let mut total_size = 0u64;
    let mut count = 0usize;
    scan_dir(&path, &mut total_size, &mut count)?;
    Ok((total_size, count))
}

fn scan_dir(dir: &PathBuf, total_size: &mut u64, count: &mut usize) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = entry.metadata() {
                    *total_size += meta.len();
                    *count += 1;
                }
            } else if path.is_dir() {
                let _ = scan_dir(&path, total_size, count);
            }
        }
    }
    Ok(())
}

async fn clean_item(item: &CleanItem) -> Result<(u64, usize), String> {
    if item.is_registry {
        return clean_registry_item(item).await;
    }
    let path = PathBuf::from(expand_env(&item.path));
    if !path.exists() {
        return Ok((0, 0));
    }
    let mut freed = 0u64;
    let mut count = 0usize;
    clean_dir(&path, &mut freed, &mut count)?;
    Ok((freed, count))
}

fn clean_dir(dir: &PathBuf, freed: &mut u64, count: &mut usize) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    if std::fs::remove_file(&path).is_ok() {
                        *freed += size;
                        *count += 1;
                    }
                }
            } else if path.is_dir() {
                let _ = clean_dir(&path, freed, count);
                let _ = std::fs::remove_dir(&path);
            }
        }
    }
    Ok(())
}

async fn clean_registry_item(_item: &CleanItem) -> Result<(u64, usize), String> {
    Ok((0, 0))
}

fn expand_env(path: &str) -> String {
    path.replace("%TEMP%", &std::env::var("TEMP").unwrap_or_default())
        .replace("%TMP%", &std::env::var("TMP").unwrap_or_default())
        .replace("%LOCALAPPDATA%", &std::env::var("LOCALAPPDATA").unwrap_or_default())
        .replace("%APPDATA%", &std::env::var("APPDATA").unwrap_or_default())
        .replace("%WINDIR%", &std::env::var("WINDIR").unwrap_or_default())
        .replace("%SYSTEMROOT%", &std::env::var("SYSTEMROOT").unwrap_or_default())
        .replace("%USERPROFILE%", &std::env::var("USERPROFILE").unwrap_or_default())
        .replace("%PROGRAMFILES(X86)%", &std::env::var("PROGRAMFILES(X86)").unwrap_or_default())
}

fn build_categories() -> Vec<CleanCategory> {
    vec![
        CleanCategory {
            id: "system".into(),
            name: "Sistema".into(),
            description: "Arquivos temporários, logs, relatórios de erro".into(),
            checked: true,
            items: vec![
                CleanItem { id: "temp".into(), name: "Arquivos Temporários".into(), path: "%TEMP%".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "tmp".into(), name: "Pasta TMP".into(), path: "%TMP%".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "prefetch".into(), name: "Prefetch".into(), path: "%WINDIR%\\Prefetch".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "recent".into(), name: "Documentos Recentes".into(), path: "%APPDATA%\\Microsoft\\Windows\\Recent".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "memory_dumps".into(), name: "Memory Dumps".into(), path: "%WINDIR%\\Minidump".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "chkdsk".into(), name: "Fragmentos Chkdsk".into(), path: "%WINDIR%\\*.chk".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "windows_logs".into(), name: "Logs do Windows".into(), path: "%WINDIR%\\Logs".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "error_reports".into(), name: "Relatórios de Erro".into(), path: "%LOCALAPPDATA%\\Microsoft\\Windows\\WER".into(), size: 0, count: 0, checked: true, is_registry: false },
            ],
        },
        CleanCategory {
            id: "browser".into(),
            name: "Navegadores".into(),
            description: "Cache, cookies, histórico, sessões".into(),
            checked: true,
            items: vec![
                CleanItem { id: "edge_cache".into(), name: "Edge Cache".into(), path: "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "edge_cookies".into(), name: "Edge Cookies".into(), path: "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Network".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "chrome_cache".into(), name: "Chrome Cache".into(), path: "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "chrome_cookies".into(), name: "Chrome Cookies".into(), path: "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Network".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "firefox_cache".into(), name: "Firefox Cache".into(), path: "%APPDATA%\\Mozilla\\Firefox\\Profiles".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "brave_cache".into(), name: "Brave Cache".into(), path: "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "opera_cache".into(), name: "Opera Cache".into(), path: "%APPDATA%\\Opera Software\\Opera Stable\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
            ],
        },
        CleanCategory {
            id: "apps".into(),
            name: "Aplicativos".into(),
            description: "Caches de apps comuns".into(),
            checked: true,
            items: vec![
                CleanItem { id: "spotify_cache".into(), name: "Spotify Cache".into(), path: "%APPDATA%\\Spotify\\Storage".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "discord_cache".into(), name: "Discord Cache".into(), path: "%APPDATA%\\discord\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "steam_cache".into(), name: "Steam Cache".into(), path: "%PROGRAMFILES(X86)%\\Steam\\appcache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "vs_cache".into(), name: "VS Code Cache".into(), path: "%APPDATA%\\Code\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "teams_cache".into(), name: "Teams Cache".into(), path: "%APPDATA%\\Microsoft\\Teams\\Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "adobe_cache".into(), name: "Adobe Cache".into(), path: "%APPDATA%\\Adobe\\Common\\Media Cache".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "nvidia_cache".into(), name: "NVIDIA Cache".into(), path: "%TEMP%\\NVIDIA".into(), size: 0, count: 0, checked: true, is_registry: false },
            ],
        },
        CleanCategory {
            id: "registry".into(),
            name: "Registro".into(),
            description: "Chaves órfãs, extensões inválidas, MRUs".into(),
            checked: false,
            items: vec![
                CleanItem { id: "reg_uninstall".into(), name: "Desinstaladores Órfãos".into(), path: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall".into(), size: 0, count: 0, checked: true, is_registry: true },
                CleanItem { id: "reg_shared".into(), name: "DLLs Compartilhadas".into(), path: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs".into(), size: 0, count: 0, checked: true, is_registry: true },
                CleanItem { id: "reg_com".into(), name: "COM/ActiveX".into(), path: "HKCR\\CLSID".into(), size: 0, count: 0, checked: true, is_registry: true },
                CleanItem { id: "reg_file_ext".into(), name: "Extensões de Arquivo".into(), path: "HKCR".into(), size: 0, count: 0, checked: true, is_registry: true },
                CleanItem { id: "reg_mru".into(), name: "Listas MRU".into(), path: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU".into(), size: 0, count: 0, checked: false, is_registry: true },
                CleanItem { id: "reg_fonts".into(), name: "Fontes".into(), path: "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts".into(), size: 0, count: 0, checked: true, is_registry: true },
                CleanItem { id: "reg_help".into(), name: "Arquivos de Ajuda".into(), path: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths".into(), size: 0, count: 0, checked: true, is_registry: true },
            ],
        },
        CleanCategory {
            id: "advanced".into(),
            name: "Avançado".into(),
            description: "Itens que exigem cuidado".into(),
            checked: false,
            items: vec![
                CleanItem { id: "old_prefetch".into(), name: "Prefetch Antigo (>30 dias)".into(), path: "%WINDIR%\\Prefetch".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "windows_update".into(), name: "Windows Update Cleanup".into(), path: "%WINDIR%\\SoftwareDistribution\\Download".into(), size: 0, count: 0, checked: false, is_registry: false },
                CleanItem { id: "thumbnails".into(), name: "Thumbnails".into(), path: "%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "icon_cache".into(), name: "Icon Cache".into(), path: "%LOCALAPPDATA%\\IconCache.db".into(), size: 0, count: 0, checked: true, is_registry: false },
                CleanItem { id: "dns_cache".into(), name: "DNS Cache".into(), path: "flushdns".into(), size: 0, count: 0, checked: false, is_registry: false },
            ],
        },
    ]
}

fn get_startup_items_impl() -> Result<Vec<StartupItem>, String> {
    let mut items = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let run_keys = vec![
        (hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run"), "HKCU\\Run"),
        (hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\RunOnce"), "HKCU\\RunOnce"),
        (hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"), "HKLM\\Run"),
        (hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"), "HKLM\\RunOnce"),
    ];

    for (key_result, location) in run_keys {
        if let Ok(key) = key_result {
            for val in key.enum_values().flatten() {
                if let Ok(path) = val.1.to_string() {
                    items.push(StartupItem {
                        name: val.0,
                        path,
                        enabled: true,
                        location: location.into(),
                    });
                }
            }
        }
    }

    let startup_folder = dirs::data_dir()
        .map(|p| p.join(r"Microsoft\Windows\Start Menu\Programs\Startup"))
        .unwrap_or_default();
    if startup_folder.exists() {
        if let Ok(entries) = std::fs::read_dir(&startup_folder) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                    items.push(StartupItem {
                        name: name.into(),
                        path: path.to_string_lossy().into(),
                        enabled: true,
                        location: "Startup Folder".into(),
                    });
                }
            }
        }
    }

    Ok(items)
}

fn toggle_startup_impl(path: &str, enable: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_SET_VALUE)?;
    let name = std::path::Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if enable {
        key.set_value(name, &path)?;
    } else {
        let _ = key.delete_value(name);
    }
    Ok(())
}

fn get_installed_programs_impl() -> Result<Vec<InstalledProgram>, String> {
    let mut programs = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let uninstall_key = hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")?;

    for subkey_name in uninstall_key.enum_keys().flatten() {
        if let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) {
            let name: String = subkey.get_value("DisplayName").unwrap_or_default();
            if name.is_empty() { continue; }
            let version: String = subkey.get_value("DisplayVersion").unwrap_or_default();
            let publisher: String = subkey.get_value("Publisher").unwrap_or_default();
            let install_date: String = subkey.get_value("InstallDate").unwrap_or_default();
            let size: String = subkey.get_value("EstimatedSize").map(|v: u32| format!("{} KB", v)).unwrap_or_default();
            let uninstall_string: String = subkey.get_value("UninstallString").unwrap_or_default();

            programs.push(InstalledProgram {
                name, version, publisher, install_date, size, uninstall_string,
            });
        }
    }

    Ok(programs)
}

fn uninstall_program_impl(name: &str) -> Result<(), String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let uninstall_key = hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")?;

    for subkey_name in uninstall_key.enum_keys().flatten() {
        if let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) {
            let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
            if display_name == name {
                let uninstall_string: String = subkey.get_value("UninstallString").unwrap_or_default();
                if !uninstall_string.is_empty() {
                    std::process::Command::new("cmd")
                        .args(["/c", &uninstall_string])
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                break;
            }
        }
    }
    Ok(())
}

fn analyze_disk_impl(path: &str) -> Result<DiskAnalysis, String> {
    let root = PathBuf::from(path);
    let mut total_size = 0u64;
    let mut folders = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let mut size = 0u64;
                let mut count = 0usize;
                let _ = scan_dir(&path, &mut size, &mut count);
                if size > 0 {
                    total_size += size;
                    folders.push(FolderSize {
                        name: path.file_name().and_then(|s| s.to_str()).unwrap_or("").into(),
                        path: path.to_string_lossy().into(),
                        size,
                        file_count: count,
                    });
                }
            }
        }
    }

    folders.sort_by(|a, b| b.size.cmp(&a.size));
    folders.truncate(20);

    Ok(DiskAnalysis { path: path.into(), total_size, folders })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_categories,
            start_scan,
            cancel_scan,
            clean_selected,
            open_folder,
            get_startup_items,
            toggle_startup_item,
            uninstall_program,
            get_installed_programs,
            analyze_disk,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();
            #[cfg(debug_assertions)]
            window.open_devtools();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}