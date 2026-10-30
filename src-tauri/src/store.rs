use crate::model::Data;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(0);

pub fn new_id(prefix: &str) -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{}{}{}", prefix, t, n)
}

/// 读取本地数据。文件损坏时自动备份为 .bak 并回退到默认数据，
/// 保证任何情况下程序都能启动。
pub fn load(path: &Path) -> Data {
    match fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str::<Data>(&s) {
            Ok(mut d) => {
                d.normalize_order();
                d
            }
            Err(_) => {
                let _ = fs::copy(path, path.with_extension("bak"));
                Data::default()
            }
        },
        Err(_) => Data::default(),
    }
}

/// 原子写入：先写临时文件再改名，避免断电/崩溃留下半个 JSON。
pub fn save(path: &Path, data: &Data) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let s = serde_json::to_string_pretty(data).map_err(|e| format!("序列化失败: {}", e))?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, s).map_err(|e| format!("写入失败: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存失败: {}", e))?;
    Ok(())
}
