use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

const SA_CLIENT_EMAIL: &str = "el-kheta-helper@long-advice-488916-j7.iam.gserviceaccount.com";
const SA_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const SA_PRIVATE_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDObwCmVuvsSUaw
EL4C3IlKEo5/mnze9im+JqSSZEfVD3KJUrwYnRWvZCbrXXx/Ur8CRVLkusZYZIq9
6fj+Ct28VmM5Wu2MivRruzKxDw2SdWMStdCFT9oaGsM+/HOIWMBYfXi9dqEW7I9j
bMbap7kz/b9hn1ZHLCUqjxR+8PLRCcsG2sq4XzbamhZ/6ENtPB7lEmQGvk5emqk6
X+oNx/JyXhNLZT0LvY4R09oJjde66hscKs9c7eQttPEhyJPNBwgqb+IIvqVwRnUY
CzLJ7U5Fz180B3PbsjHCXYCQ9Qn+YjQV46luilR7prolLb3CjRLyBQFSRLwdVjZc
5E0NiQcLAgMBAAECggEAAwWMu/wvIhT+gMqpJVyTpXufdCgcQAOlbJM41HjwTjxj
WYKjBM83B1hPDSHsr4AHRYhWcS+rG8i4+S4VrXSv3NDJs6GGAAkmqiiiBZ9Dr35u
/IUGlnT3q2smqxZ1HUYc5qhLhKZzlcs3qOWcnljwwcPEmEnsFuJpo6i9f/aVIoP1
8mN3TU4IvbdFZB34cyAv738zMv11J8i2uWSXBtNy9RQKCgfiBAJ0wWDDfn5eUAgZ
QIsmtxc4zMO6mcWXUrCeKOMw8GQoQAZQj1vxJzWxXPXzSgXSRYK0f0hxOpbQvoo9
4QsqSOppexafTjM7bDBbajhBFUrm1Ex08R2tSWWlGQKBgQDu35r5VmCj6lk44m4X
aOTmNbY7vnl2+jyp/Wv+D9ckDXeozsp3owYCIGz4s1r2BJVraFOL0FS9+9UC1hf4
lbPL02H24JyW8gq1NTzhvBNBJoFRq/cClJtENwjfLOTk9j2jmTrEyS3Oa0DOwxgw
+lUReGOYKVFVBV9UEfyZ3SuF4wKBgQDdO/shXm9/VmeV2/yEDjRoB8nPyzPbW2+A
PK6jsesZj8kcJO9M5YJDiNBZ6oDpBjMKGpThOfEAn9cv49RkzuQ1SyOG+1P5rsjs
Wh56e93LaCCzJxxYlaIROg+QRtR3LwBmTNOOghwhiY1jz8fjIf8OejnQgLm6aFjC
AnlTUAiCuQKBgDmMe3yol73F3tr6ikVviv3/YLkCCadlYCogGN1rmYxhBjwQHe02
xGLMxxQfucFdl1X6G26qsU/YFRiK1dmYz2lCsu5UbMVc6MGBYvqLYiQnD67KfEcN
4F5N2ABUg4y52l3Is8TnJvb9Fe76R6C9HrOHyo7FHYgbND0/3BiBlVO7AoGBAL8U
O0cK5Yo5+qW4p1T3X9QqRegvPc7MHnXH85524PPm+HBShk0IPYZO+IVwwX6CWDr1
0njlLn63j4hRYvTerMRK7Zh8In+YsvlQrNpleZ9hhDy4Hwdz1dLDLwYR5xg5hELX
QDHptppQz8nRgHdwuXaropuvUrrpvR90O431piQhAoGAQRpTNO7mz2x4U9/x9XFW
AecAcfbmcCCzAscZINy1xf58hhT4j22uFjJGPxv3czD6nVeqLhVjflMZ++l6r6XL
zWgIV0nMRJE4517Qolt4HWIiMnYXEipKgKMQNplDBYl1d8VcF6M2NhxfeGl5hLqB
80nk+0otDBLjjZaAq8Nzsxk=
-----END PRIVATE KEY-----"#;

const SHEET_ID: &str = "1Hm7noXxv8ITMU3dNXQmqFEzfZY1mZlBJ4bQ9_ZIR0-M";
const SHEET_NAME: &str = "OPERATIONS";
const WOL_EXE: &str = r"C:\Program Files\Aquila Technology\WakeOnLAN\WakeOnLanC.exe";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JwtClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: i64,
    iat: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRootIn {
    id: i64,
    name: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunSearchRequest {
    roots: Vec<SearchRootIn>,
    folders: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootStatusOut {
    id: i64,
    state: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultRowOut {
    order: usize,
    name: String,
    found: bool,
    folders: i64,
    clips: i64,
    duration_min: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunSearchResponse {
    elapsed_sec: i64,
    root_statuses: Vec<RootStatusOut>,
    results: Vec<SearchResultRowOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetFolderRow {
    name: String,
    row: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadFromSheetResponse {
    folders: Vec<String>,
    rows: Vec<SheetFolderRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSheetRowIn {
    name: String,
    found: bool,
    duration_min: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSheetRequest {
    rows: Vec<UpdateSheetRowIn>,
    row_map: HashMap<String, i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSheetResponse {
    updated_rows: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidateRootResponse {
    reachable: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchRootConfig {
    name: String,
    path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    search_roots: Vec<SearchRootConfig>,
    teachers: Vec<String>,
}

#[tauri::command]
fn load_app_config() -> Result<AppConfig, String> {
    read_app_config()
}

#[tauri::command]
fn save_app_config(config: AppConfig) -> Result<(), String> {
    write_app_config(&config)
}

#[tauri::command]
fn validate_root(path: String) -> Result<ValidateRootResponse, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(ValidateRootResponse { reachable: false });
    }

    if let Some(host) = extract_unc_hostname(trimmed) {
        if !ping_host(host.as_str(), 1) {
            return Ok(ValidateRootResponse { reachable: false });
        }
        return Ok(ValidateRootResponse {
            reachable: Path::new(trimmed).exists(),
        });
    }

    Ok(ValidateRootResponse {
        reachable: Path::new(trimmed).exists(),
    })
}

#[tauri::command]
fn load_from_sheet() -> Result<LoadFromSheetResponse, String> {
    let token = get_access_token()?;
    let url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}!A:O",
        SHEET_ID, SHEET_NAME
    );
    let client = Client::new();
    let value: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("Sheet request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Sheet response error: {e}"))?
        .json()
        .map_err(|e| format!("Sheet parse error: {e}"))?;

    let values = value
        .get("values")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No values returned from sheet".to_string())?;

    let allowed_teachers = configured_teachers()?;
    let mut rows = Vec::<SheetFolderRow>::new();
    let mut seen = HashSet::<String>::new();

    for (idx, row_v) in values.iter().enumerate() {
        if idx == 0 {
            continue;
        }
        let Some(row_arr) = row_v.as_array() else {
            continue;
        };
        let get_cell = |i: usize| -> String {
            row_arr
                .get(i)
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .trim()
                .to_string()
        };

        let col_n = get_cell(13).to_uppercase();
        let col_o = get_cell(14);
        let col_i = get_cell(8);
        let col_k = get_cell(10);
        let col_m = get_cell(12);
        let teacher = col_k
            .rsplit_once('-')
            .map(|(_, t)| t.trim().to_string())
            .unwrap_or(col_k.clone());

        let pass = (col_n == "SMARTBOARD" || col_n == "TO BE CHECKED LATER")
            && col_o.is_empty()
            && !col_i.contains("(Q)")
            && !col_i.contains("امتحان")
            && !col_m.is_empty()
            && allowed_teachers.contains(&teacher);

        if pass && !seen.contains(&col_m) {
            seen.insert(col_m.clone());
            rows.push(SheetFolderRow {
                name: col_m,
                row: (idx + 1) as i64,
            });
        }
    }

    let folders = rows.iter().map(|r| r.name.clone()).collect::<Vec<_>>();
    Ok(LoadFromSheetResponse { folders, rows })
}

#[tauri::command]
fn run_search(request: RunSearchRequest) -> Result<RunSearchResponse, String> {
    let started = Instant::now();
    let mut root_statuses = Vec::<RootStatusOut>::new();

    let mut row_index = HashMap::<String, Vec<usize>>::new();
    let mut results = request
        .folders
        .iter()
        .enumerate()
        .map(|(i, name)| {
            row_index.entry(name.clone()).or_default().push(i);
            SearchResultRowOut {
                order: i,
                name: name.clone(),
                found: false,
                folders: 0,
                clips: 0,
                duration_min: 0,
            }
        })
        .collect::<Vec<_>>();

    for root in &request.roots {
        let (reachable, woke) = ensure_root_reachable(&root.path);
        if !reachable {
            root_statuses.push(RootStatusOut {
                id: root.id,
                state: "unreachable".to_string(),
                status: "Unreachable".to_string(),
            });
            continue;
        }

        let root_map = scan_root(&root.path, &row_index)?;
        for (name, (folder_hits, clip_hits, total_seconds)) in root_map {
            if let Some(indices) = row_index.get(&name) {
                for idx in indices {
                    if let Some(r) = results.get_mut(*idx) {
                        r.folders += folder_hits;
                        r.clips += clip_hits;
                        r.duration_min += ((total_seconds as f64) / 60.0).round() as i64;
                    }
                }
            }
        }

        if woke {
            let _ = shutdown_if_woke(&root.path);
        }

        root_statuses.push(RootStatusOut {
            id: root.id,
            state: "done".to_string(),
            status: "Done".to_string(),
        });
    }

    for row in &mut results {
        row.found = row.clips > 0;
    }

    Ok(RunSearchResponse {
        elapsed_sec: started.elapsed().as_secs() as i64,
        root_statuses,
        results,
    })
}

#[tauri::command]
fn update_sheet(request: UpdateSheetRequest) -> Result<UpdateSheetResponse, String> {
    let token = get_access_token()?;
    let updates = request
        .rows
        .iter()
        .filter(|r| r.found)
        .filter_map(|r| {
            request
                .row_map
                .get(&r.name)
                .map(|row_num| (*row_num, r.duration_min.max(0)))
        })
        .collect::<Vec<_>>();

    if updates.is_empty() {
        return Ok(UpdateSheetResponse {
            updated_rows: 0,
            message: "No rows to update.".to_string(),
        });
    }

    let data = updates
        .iter()
        .map(|(row_num, mins)| {
            json!({
                "range": format!("{}!O{}", SHEET_NAME, row_num),
                "values": [[mins]]
            })
        })
        .collect::<Vec<_>>();

    let body = json!({
        "valueInputOption": "RAW",
        "data": data
    });

    let url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}/values:batchUpdate",
        SHEET_ID
    );
    let client = Client::new();
    client
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|e| format!("Sheet update failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Sheet update response error: {e}"))?;

    Ok(UpdateSheetResponse {
        updated_rows: updates.len(),
        message: format!("Done. Updated {} row(s).", updates.len()),
    })
}

fn get_access_token() -> Result<String, String> {
    let iat = Utc::now().timestamp();
    let exp = iat + 3600;
    let claims = JwtClaims {
        iss: SA_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: SA_TOKEN_URI,
        exp,
        iat,
    };
    let key = EncodingKey::from_rsa_pem(SA_PRIVATE_KEY.as_bytes())
        .map_err(|e| format!("Private key parse failed: {e}"))?;
    let jwt = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| format!("JWT encode failed: {e}"))?;

    let client = Client::new();
    let params = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
        ("assertion", jwt.as_str()),
    ];

    let value: serde_json::Value = client
        .post(SA_TOKEN_URI)
        .form(&params)
        .send()
        .map_err(|e| format!("Token request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Token response error: {e}"))?
        .json()
        .map_err(|e| format!("Token parse failed: {e}"))?;

    value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Token missing access_token".to_string())
}

fn default_teachers() -> Vec<String> {
    [
        "Nour Essam",
        "Mohamed Hossam",
        "Eslam Morsy",
        "Ahmed Yehia",
        "Eslam Abdelazeem",
        "Mohamed Ebrahim",
        "Ahmed Salah",
        "Hossam Elashry",
        "Atef Ramzy",
        "Ekrami Eltaweel",
        "Abanoub Hezkial",
        "Ali Youssef",
        "Mahitab Tarek",
        "Hany Elrefaey",
        "Karolen Samy",
        "Omar Hussien",
        "Saleh Abuzaid",
        "Hoda Farouk",
        "Mina Fayez",
        "Ahmed bakr",
        "Bosy Magdy",
        "Fatma Ebrahim",
        "Ahmed Salem",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn config_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot resolve exe path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Cannot resolve app directory".to_string())?;
    Ok(dir.join("rmc.config.json"))
}

fn read_app_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig {
            search_roots: vec![],
            teachers: default_teachers(),
        });
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read config: {e}"))?;
    let mut cfg: AppConfig =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid config JSON: {e}"))?;
    if cfg.teachers.is_empty() {
        cfg.teachers = default_teachers();
    }
    Ok(cfg)
}

fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let normalized = AppConfig {
        search_roots: config
            .search_roots
            .iter()
            .filter(|r| !r.path.trim().is_empty())
            .map(|r| SearchRootConfig {
                name: r.name.trim().to_string(),
                path: r.path.trim().to_string(),
            })
            .collect(),
        teachers: config
            .teachers
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
    };

    let json = serde_json::to_string_pretty(&normalized).map_err(|e| format!("Config encode failed: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Cannot write config: {e}"))?;
    Ok(())
}

fn configured_teachers() -> Result<HashSet<String>, String> {
    let cfg = read_app_config()?;
    Ok(cfg.teachers.into_iter().collect())
}

fn ensure_root_reachable(root_path: &str) -> (bool, bool) {
    let hostname = extract_unc_hostname(root_path);

    if let Some(host) = hostname.as_deref() {
        if ping_host(host, 2) && Path::new(root_path).exists() {
            return (true, false);
        }

        if Path::new(WOL_EXE).exists() {
            let _ = Command::new(WOL_EXE).args(["-w", "-m", host]).output();
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(120) {
                if ping_host(host, 1) && Path::new(root_path).exists() {
                    return (true, true);
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        return (false, false);
    }

    (Path::new(root_path).exists(), false)
}

fn shutdown_if_woke(root_path: &str) -> Result<(), String> {
    let Some(host) = extract_unc_hostname(root_path) else {
        return Ok(());
    };
    Command::new(WOL_EXE)
        .args(["-s", "-m", host.as_str(), "-t", "0", "-f"])
        .output()
        .map_err(|e| format!("Shutdown call failed: {e}"))?;
    Ok(())
}

fn extract_unc_hostname(path: &str) -> Option<String> {
    if !path.starts_with(r"\\") {
        return None;
    }
    let stripped = path.trim_start_matches(r"\\");
    stripped.split('\\').next().map(str::to_string)
}

fn ping_host(host: &str, count: usize) -> bool {
    Command::new("ping")
        .args([
            "-n",
            &count.to_string(),
            "-w",
            "1000",
            host,
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn scan_root(
    root_path: &str,
    row_index: &HashMap<String, Vec<usize>>,
) -> Result<HashMap<String, (i64, i64, i64)>, String> {
    let mut map = HashMap::<String, (i64, i64, i64)>::new();
    let requested = row_index.keys().collect::<HashSet<_>>();

    let entries = std::fs::read_dir(root_path)
        .map_err(|e| format!("Cannot open root '{}': {e}", root_path))?;

    for entry_result in entries {
        let entry = match entry_result {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !requested.contains(&name) {
            continue;
        }

        let duration = sum_mvi_duration_seconds(&path);
        let clip_count = count_mvi_files(&path) as i64;
        let state = map.entry(name).or_insert((0, 0, 0));
        state.0 += 1;
        state.1 += clip_count;
        state.2 += duration;
    }

    Ok(map)
}

fn count_mvi_files(base_path: &Path) -> usize {
    walkdir::WalkDir::new(base_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .to_uppercase()
                .contains("MVI")
        })
        .count()
}

fn sum_mvi_duration_seconds(base_path: &Path) -> i64 {
    let ps = r#"
$ErrorActionPreference='SilentlyContinue'
$basePath = $args[0]
$shell = New-Object -ComObject Shell.Application
$total = 0
Get-ChildItem -LiteralPath $basePath -Recurse -File -Filter *MVI* | ForEach-Object {
  $ns = $shell.Namespace($_.DirectoryName)
  if ($null -eq $ns) { return }
  $item = $ns.ParseName($_.Name)
  if ($null -eq $item) { return }
  $dur = $ns.GetDetailsOf($item, 27)
  if ([string]::IsNullOrWhiteSpace($dur)) { return }
  $parts = $dur -split ':'
  if ($parts.Length -eq 3) {
    $total += [int]$parts[0] * 3600 + [int]$parts[1] * 60 + [int]$parts[2]
  } elseif ($parts.Length -eq 2) {
    $total += [int]$parts[0] * 60 + [int]$parts[1]
  }
}
Write-Output $total
"#;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            ps,
            &base_path.to_string_lossy(),
        ])
        .output();

    let Ok(out) = output else {
        return 0;
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    text.parse::<i64>().unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_app_config,
            save_app_config,
            validate_root,
            load_from_sheet,
            run_search,
            update_sheet
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
