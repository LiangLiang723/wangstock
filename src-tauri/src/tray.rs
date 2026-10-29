use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindowBuilder,
};

pub const FLYOUT_W: f64 = 202.0;
pub const FLYOUT_H: f64 = 430.0;

#[derive(Default)]
pub struct HoverState {
    /// 浮层当前是否可见
    pub visible: AtomicBool,
    /// 最近一次拿到的托盘图标矩形
    pub tray_rect: Mutex<Option<(i32, i32, u32, u32)>>,
}

fn rect_px(r: &Rect) -> (i32, i32, u32, u32) {
    let (x, y) = match r.position {
        tauri::Position::Physical(p) => (p.x, p.y),
        tauri::Position::Logical(p) => (p.x.round() as i32, p.y.round() as i32),
    };
    let (w, h) = match r.size {
        tauri::Size::Physical(s) => (s.width, s.height),
        tauri::Size::Logical(s) => (s.width.round() as u32, s.height.round() as u32),
    };
    (x, y, w, h)
}

#[cfg(windows)]
pub fn cursor_pos() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut p);
    }
    (p.x, p.y)
}

#[cfg(not(windows))]
pub fn cursor_pos() -> (i32, i32) {
    (200, 200)
}

#[cfg(windows)]
fn hwnd_of(win: &tauri::WebviewWindow) -> Option<isize> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let h = win.window_handle().ok()?;
    match h.as_raw() {
        RawWindowHandle::Win32(w) => Some(w.hwnd.get()),
        _ => None,
    }
}

/// Windows 11 圆角。失败时保持直角，不影响功能。
#[cfg(windows)]
pub fn round_corners(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: i32 = 2;
    if let Some(h) = hwnd_of(win) {
        let pref = DWMWCP_ROUND;
        unsafe {
            DwmSetWindowAttribute(
                h as *mut core::ffi::c_void,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const i32 as *const core::ffi::c_void,
                4,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn round_corners(_win: &tauri::WebviewWindow) {}

/// 以托盘图标为锚点计算浮层位置：图标在屏幕下半部就向上弹，
/// 并夹在工作区内，多显示器 / 高 DPI 下不会飞出屏幕。
pub fn place_flyout(
    app: &AppHandle,
    win: &tauri::WebviewWindow,
    rect: (i32, i32, u32, u32),
    height: f64,
) {
    let (ix, iy, iw, ih) = rect;
    let scale = win.scale_factor().unwrap_or(1.0);
    let pw = (FLYOUT_W * scale).round() as i32;
    let ph = (height * scale).round() as i32;

    let monitor = app
        .monitor_from_point(ix as f64 + iw as f64 / 2.0, iy as f64)
        .ok()
        .flatten();

    let (mx, my, mw, mh) = match &monitor {
        Some(m) => {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width as i32, s.height as i32)
        }
        None => (0, 0, 1920, 1080),
    };

    let cx = ix + iw as i32 / 2;
    let mut x = cx - pw / 2;
    if x + pw > mx + mw {
        x = mx + mw - pw - 8;
    }
    if x < mx + 8 {
        x = mx + 8;
    }

    let below = iy + ih as i32 + 10;
    let above = iy - ph - 10;
    let y = if below + ph <= my + mh { below } else { above };
    let y = y.max(my + 8);

    let _ = win.set_position(PhysicalPosition::new(x, y));
}

pub fn show_flyout(app: &AppHandle) {
    let Some(win) = app.get_webview_window("flyout") else {
        return;
    };
    let st = app.state::<crate::AppState>();
    if let Some(r) = *st.hover.tray_rect.lock().unwrap() {
        let scale = win.scale_factor().unwrap_or(1.0);
        let h = win
            .inner_size()
            .map(|s| s.height as f64 / scale)
            .unwrap_or(FLYOUT_H);
        place_flyout(app, &win, r, h);
    }
    round_corners(&win);
    let _ = win.show();
    let _ = win.set_focus();
    st.hover.visible.store(true, Ordering::Relaxed);
    let _ = win.emit("flyout-shown", ());
}

pub fn hide_flyout(app: &AppHandle) {
    let Some(win) = app.get_webview_window("flyout") else {
        return;
    };
    let st = app.state::<crate::AppState>();
    st.hover.visible.store(false, Ordering::Relaxed);
    let _ = win.hide();
}

pub fn toggle_flyout(app: &AppHandle) {
    let st = app.state::<crate::AppState>();
    if st.hover.visible.load(Ordering::Relaxed) {
        hide_flyout(app);
    } else {
        show_flyout(app);
    }
}

pub fn show_main(app: &AppHandle) {
    hide_flyout(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("wangstock · 右键查看行情菜单")
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                // 左键：唤出主界面（与多数 Windows 程序一致）
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => show_main(app),

                // 右键：弹出行情菜单
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } => {
                    let mut r = rect_px(&rect);
                    if r.2 == 0 || r.3 == 0 {
                        // 图标位于 Win11 溢出区时拿不到矩形，退化为光标位置
                        let (cx, cy) = cursor_pos();
                        r = (cx - 8, cy - 8, 16, 16);
                    }
                    {
                        let st = app.state::<crate::AppState>();
                        *st.hover.tray_rect.lock().unwrap() = Some(r);
                    }
                    toggle_flyout(app);
                }

                // 双击：同样回到主界面
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => show_main(app),
                _ => {}
            }
        })
        .build(app)?;

    let flyout = WebviewWindowBuilder::new(app, "flyout", WebviewUrl::App("flyout.html".into()))
        .title("wangstock")
        .inner_size(FLYOUT_W, FLYOUT_H)
        .resizable(false)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;

    let _ = flyout.hide();
    round_corners(&flyout);

    let app_handle = app.clone();
    flyout.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            hide_flyout(&app_handle);
        }
    });

    Ok(())
}
