#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod model;
mod quote;
mod store;
mod tray;

use model::*;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Manager, State, WindowEvent};

pub struct AppState {
    pub data: Mutex<Data>,
    pub file: PathBuf,
    pub hover: tray::HoverState,
    /// (缓存 key, 时间, 行情)
    pub cache: Mutex<Option<(String, Instant, Vec<Quote>)>>,
}

fn persist(st: &AppState, d: &Data) -> Result<(), String> {
    store::save(&st.file, d)
}

fn collect_subtree(groups: &[Group], id: &str) -> Vec<String> {
    let mut out = vec![id.to_string()];
    let mut i = 0;
    let mut guard = 0;
    while i < out.len() && guard < 500 {
        guard += 1;
        let cur = out[i].clone();
        for g in groups {
            if g.parent_id.as_deref() == Some(cur.as_str()) {
                out.push(g.id.clone());
            }
        }
        i += 1;
    }
    out
}

#[tauri::command]
fn get_state(st: State<AppState>) -> Data {
    st.data.lock().unwrap().clone()
}

#[tauri::command]
fn add_group(
    kind: String,
    name: String,
    parent_id: Option<String>,
    st: State<AppState>,
) -> Result<Data, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分组名称不能为空".into());
    }
    let mut d = st.data.lock().unwrap();
    let sort = d
        .groups
        .iter()
        .filter(|g| g.kind == kind && g.parent_id == parent_id)
        .count() as i64;
    let palette = ["#6ea8ff", "#b48cf2", "#4fbf8b", "#e8a33d", "#e06c75"];
    let color = if kind == "industry" {
        Some(palette[(d.groups.len()) % palette.len()].to_string())
    } else {
        None
    };
    d.groups.push(Group {
        id: store::new_id("g"),
        name,
        kind,
        parent_id,
        sort,
        collapsed: false,
        color,
    });
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn rename_group(id: String, name: String, st: State<AppState>) -> Result<Data, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分组名称不能为空".into());
    }
    let mut d = st.data.lock().unwrap();
    if let Some(g) = d.groups.iter_mut().find(|g| g.id == id) {
        g.name = name;
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn set_group_color(id: String, color: Option<String>, st: State<AppState>) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    if let Some(g) = d.groups.iter_mut().find(|g| g.id == id) {
        g.color = color;
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn delete_group(id: String, st: State<AppState>) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    let ids = collect_subtree(&d.groups, &id);
    d.groups.retain(|g| !ids.contains(&g.id));
    d.members.retain(|m| !ids.contains(&m.group_id));
    let used: Vec<String> = d.members.iter().map(|m| m.symbol.clone()).collect();
    d.instruments.retain(|i| used.contains(&i.symbol));
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn toggle_group(id: String, collapsed: bool, st: State<AppState>) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    if let Some(g) = d.groups.iter_mut().find(|g| g.id == id) {
        g.collapsed = collapsed;
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn move_group(
    id: String,
    parent_id: Option<String>,
    index: i64,
    st: State<AppState>,
) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    // 禁止把分组拖进自己的子树，否则会形成环。
    if let Some(pid) = parent_id.as_deref() {
        if collect_subtree(&d.groups, &id).iter().any(|x| x == pid) {
            return Err("不能把分组移动到它自己内部".into());
        }
    }
    if let Some(g) = d.groups.iter_mut().find(|g| g.id == id) {
        g.parent_id = parent_id.clone();
    }
    let kind = d
        .groups
        .iter()
        .find(|g| g.id == id)
        .map(|g| g.kind.clone())
        .unwrap_or_else(|| "watch".into());
    let mut ids: Vec<String> = d
        .groups
        .iter()
        .filter(|g| g.parent_id == parent_id && g.kind == kind && g.id != id)
        .map(|g| g.id.clone())
        .collect();
    let at = index.max(0).min(ids.len() as i64) as usize;
    ids.insert(at, id);
    for (i, gid) in ids.iter().enumerate() {
        if let Some(g) = d.groups.iter_mut().find(|g| &g.id == gid) {
            g.sort = i as i64;
        }
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
async fn add_symbol(symbol: String, group_id: String, app: tauri::AppHandle) -> Result<Data, String> {
    let sym = quote::normalize_symbol(&symbol).ok_or_else(|| "无法识别的代码格式".to_string())?;

    // 需要补名称时先发网络请求，此时不持有数据锁。
    let need_lookup = {
        let st = app.state::<AppState>();
        let d = st.data.lock().unwrap();
        !d.instruments.iter().any(|i| i.symbol == sym)
    };
    let looked = if need_lookup {
        let s2 = sym.clone();
        tauri::async_runtime::spawn_blocking(move || quote::lookup_name(&s2))
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    let st = app.state::<AppState>();
    let mut d = st.data.lock().unwrap();
    if !d.groups.iter().any(|g| g.id == group_id) {
        return Err("目标分组不存在".into());
    }
    if !d.instruments.iter().any(|i| i.symbol == sym) {
        let (name, kind) = match looked {
            Some((n, k)) => (n, k),
            None => (code_of(&sym), "stock".to_string()),
        };
        d.instruments.push(Instrument {
            symbol: sym.clone(),
            code: code_of(&sym),
            market: market_of(&sym).to_string(),
            name,
            kind,
        });
    }
    if !d
        .members
        .iter()
        .any(|m| m.group_id == group_id && m.symbol == sym)
    {
        let sort = d
            .members
            .iter()
            .filter(|m| m.group_id == group_id)
            .count() as i64;
        d.members.push(Member {
            group_id,
            symbol: sym,
            sort,
        });
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn remove_symbol(symbol: String, group_id: String, st: State<AppState>) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    d.members
        .retain(|m| !(m.group_id == group_id && m.symbol == symbol));
    let still_used = d.members.iter().any(|m| m.symbol == symbol);
    if !still_used {
        d.instruments.retain(|i| i.symbol != symbol);
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn move_symbol(
    symbol: String,
    from_group: String,
    to_group: String,
    st: State<AppState>,
) -> Result<Data, String> {
    if from_group == to_group {
        return Ok(st.data.lock().unwrap().clone());
    }
    let mut d = st.data.lock().unwrap();
    if !d.groups.iter().any(|g| g.id == to_group) {
        return Err("目标分组不存在".into());
    }
    d.members
        .retain(|m| !(m.group_id == from_group && m.symbol == symbol));
    let exists = d
        .members
        .iter()
        .any(|m| m.group_id == to_group && m.symbol == symbol);
    if !exists {
        let sort = d.members.iter().filter(|m| m.group_id == to_group).count() as i64;
        d.members.push(Member {
            group_id: to_group,
            symbol,
            sort,
        });
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn reorder_symbols(
    group_id: String,
    symbols: Vec<String>,
    st: State<AppState>,
) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    for (i, sym) in symbols.iter().enumerate() {
        if let Some(m) = d
            .members
            .iter_mut()
            .find(|m| m.group_id == group_id && &m.symbol == sym)
        {
            m.sort = i as i64;
        }
    }
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
fn update_settings(settings: Settings, st: State<AppState>) -> Result<Data, String> {
    let mut d = st.data.lock().unwrap();
    d.settings = settings;
    persist(&st, &d)?;
    Ok(d.clone())
}

#[tauri::command]
async fn search_symbols(query: String) -> Vec<SearchHit> {
    tauri::async_runtime::spawn_blocking(move || quote::search(&query))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn get_quotes(symbols: Vec<String>, app: tauri::AppHandle) -> Result<Vec<Quote>, String> {
    if symbols.is_empty() {
        return Ok(Vec::new());
    }
    // 网络请求放到阻塞线程池，主线程保持响应；否则一次超时就会把界面卡住数秒。
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<AppState>();
        let key = symbols.join(",");
        {
            let c = st.cache.lock().unwrap();
            if let Some((k, t, q)) = c.as_ref() {
                if k == &key && t.elapsed().as_millis() < 700 {
                    return Ok(q.clone());
                }
            }
        }
        match quote::fetch(&symbols) {
            Ok(v) => {
                *st.cache.lock().unwrap() = Some((key, Instant::now(), v.clone()));
                Ok(v)
            }
            Err(e) => {
                // 网络彻底失败时回落到上一次成功的数据，并把状态标成 stale，
                // 让界面明确告诉用户"这不是最新价"。
                let c = st.cache.lock().unwrap();
                if let Some((_, _, q)) = c.as_ref() {
                    let want: std::collections::HashSet<&String> = symbols.iter().collect();
                    let mut fb: Vec<Quote> = q
                        .iter()
                        .filter(|x| want.contains(&x.symbol))
                        .cloned()
                        .collect();
                    for x in &mut fb {
                        x.status = "stale".into();
                    }
                    if !fb.is_empty() {
                        return Ok(fb);
                    }
                }
                Err(format!("行情获取失败：{}", e))
            }
        }
    })
    .await
    .map_err(|e| format!("行情任务失败: {}", e))?
}

#[tauri::command]
async fn get_detail(symbol: String) -> Result<Detail, String> {
    tauri::async_runtime::spawn_blocking(move || quote::fetch_detail(&symbol))
        .await
        .map_err(|e| format!("详情任务失败: {}", e))?
}

#[tauri::command]
async fn get_minute(symbol: String) -> Result<Vec<MinutePoint>, String> {
    tauri::async_runtime::spawn_blocking(move || quote::fetch_minute(&symbol))
        .await
        .map_err(|e| format!("分时任务失败: {}", e))?
}

#[tauri::command]
async fn get_kline(symbol: String, period: String, limit: usize) -> Result<Vec<Candle>, String> {
    tauri::async_runtime::spawn_blocking(move || quote::fetch_kline(&symbol, &period, limit))
        .await
        .map_err(|e| format!("K线任务失败: {}", e))?
}

/// 列表缩略图数据，网络部分同样放到阻塞线程池。
#[tauri::command]
async fn get_sparklines(
    symbols: Vec<String>,
) -> Result<std::collections::HashMap<String, Vec<f64>>, String> {
    tauri::async_runtime::spawn_blocking(move || quote::fetch_sparklines(&symbols))
        .await
        .map_err(|e| format!("缩略图任务失败: {}", e))
}

#[tauri::command]
fn show_main_cmd(app: tauri::AppHandle) {
    tray::show_main(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn hide_flyout_cmd(app: tauri::AppHandle) {
    tray::hide_flyout(&app);
}

/// 浮层按内容行数自适应高度，并重新贴回托盘图标。
#[tauri::command]
fn resize_flyout(height: f64, app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("flyout") {
        let h = height.clamp(140.0, 560.0);
        let _ = w.set_size(tauri::LogicalSize::new(tray::FLYOUT_W, h));
        let rect = *app.state::<AppState>().hover.tray_rect.lock().unwrap();
        if let Some(r) = rect {
            tray::place_flyout(&app, &w, r, h);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&dir);
            let file = dir.join("data.json");
            if !file.exists() {
                if let Ok(appdata) = std::env::var("APPDATA") {
                    let old = PathBuf::from(appdata)
                        .join("com.quotedesk.desktop")
                        .join("data.json");
                    if old.exists() {
                        let _ = std::fs::copy(&old, &file);
                    }
                }
            }
            let data = store::load(&file);

            app.manage(AppState {
                data: Mutex::new(data),
                file,
                hover: tray::HoverState::default(),
                cache: Mutex::new(None),
            });

            tray::build(app.handle())?;

            if let Some(w) = app.get_webview_window("main") {
                tray::round_corners(&w);
                let w2 = w.clone();
                w.on_window_event(move |e| match e {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = w2.hide();
                    }
                    WindowEvent::Resized(_) => {
                        if w2.is_minimized().unwrap_or(false) {
                            let _ = w2.hide();
                        }
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            add_group,
            rename_group,
            set_group_color,
            delete_group,
            toggle_group,
            move_group,
            add_symbol,
            remove_symbol,
            move_symbol,
            reorder_symbols,
            update_settings,
            search_symbols,
            get_quotes,
            get_detail,
            get_minute,
            get_kline,
            get_sparklines,
            show_main_cmd,
            quit_app,
            hide_flyout_cmd,
            resize_flyout
        ])
        .run(tauri::generate_context!())
        .expect("wangstock 启动失败");
}
