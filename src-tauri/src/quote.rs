use crate::model::{market_of, Candle, Detail, Level, MinutePoint, Quote, SearchHit};
use chrono::{Datelike, Local, Timelike, Weekday};
use encoding_rs::GBK;
use std::io::Read;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// 统一走一次 GET，按 GBK 解码（腾讯/新浪行情接口均为 GBK）。
/// 限制响应体 4MB，防止异常响应把内存打爆。
fn http_get(url: &str, referer: &str, timeout_ms: u64) -> Result<String, String> {
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .set("Referer", referer)
        .set("Accept", "*/*")
        .timeout(Duration::from_millis(timeout_ms))
        .call()
        .map_err(|e| format!("{}", e))?;
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    resp.into_reader()
        .take(4 * 1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = GBK.decode(&buf);
    Ok(text.into_owned())
}

fn normalize_time(s: &str) -> String {
    let t = s.trim();
    if t.len() >= 14 && t.bytes().all(|b| b.is_ascii_digit()) {
        return format!("{}:{}:{}", &t[8..10], &t[10..12], &t[12..14]);
    }
    if let Some(pos) = t.find(' ') {
        let clock = &t[pos + 1..];
        if clock.len() >= 5 {
            return clock.to_string();
        }
    }
    t.to_string()
}

fn in_session(market: &str, minutes: u32, wd: Weekday) -> bool {
    if matches!(wd, Weekday::Sat | Weekday::Sun) {
        return false;
    }
    if market == "HK" {
        (9 * 60 + 20..=12 * 60 + 5).contains(&minutes)
            || (12 * 60 + 55..=16 * 60 + 15).contains(&minutes)
    } else {
        (9 * 60 + 15..=11 * 60 + 35).contains(&minutes)
            || (12 * 60 + 55..=15 * 60 + 10).contains(&minutes)
    }
}

/// 用「行情时间戳 vs 本机时间」判定新鲜度，比单纯看时钟更可靠：
/// 收盘后是 closed，盘中但时间落后超过 5 分钟是 delayed。
fn compute_status(market: &str, time: &str) -> String {
    let now = Local::now();
    if !in_session(market, now.hour() * 60 + now.minute(), now.weekday()) {
        return "closed".into();
    }
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() == 3 {
        if let (Ok(h), Ok(m), Ok(s)) = (
            parts[0].parse::<i32>(),
            parts[1].parse::<i32>(),
            parts[2].parse::<i32>(),
        ) {
            let qt = h * 3600 + m * 60 + s;
            let nt = now.hour() as i32 * 3600 + now.minute() as i32 * 60 + now.second() as i32;
            if nt - qt > 300 {
                return "delayed".into();
            }
        }
    }
    "live".into()
}

fn fnum(f: &[&str], i: usize) -> f64 {
    f.get(i)
        .and_then(|s| s.trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}

/// 腾讯行情：A 股与港股的字段下标完全一致（1 名称 / 3 最新 / 4 昨收 /
/// 5 今开 / 30 时间 / 33 最高 / 34 最低 / 36 量 / 37 额），
/// 差异只在单位：A 股量是「手」、额是「万元」；港股量是「股」、额是「元」。
fn parse_tencent(text: &str) -> Vec<Quote> {
    let mut out = Vec::new();
    for raw in text.split(';') {
        let seg = raw.trim();
        if !seg.starts_with("v_") {
            continue;
        }
        let eq = match seg.find('=') {
            Some(i) => i,
            None => continue,
        };
        let key = &seg[2..eq];
        let val = seg[eq + 1..].trim().trim_matches('"');
        if val.is_empty() {
            continue;
        }
        let f: Vec<&str> = val.split('~').collect();
        if f.len() < 38 {
            continue;
        }
        let is_hk = key.starts_with("hk");
        let price = fnum(&f, 3);
        let prev = fnum(&f, 4);
        if price <= 0.0 || prev <= 0.0 {
            continue;
        }
        let (volume, amount) = if is_hk {
            (fnum(&f, 36), fnum(&f, 37))
        } else {
            (fnum(&f, 36) * 100.0, fnum(&f, 37) * 10_000.0)
        };
        let time = normalize_time(f.get(30).copied().unwrap_or(""));
        let market = if is_hk { "HK" } else { "CN" };
        let change = price - prev;
        out.push(Quote {
            symbol: key.to_string(),
            name: f.get(1).unwrap_or(&"").to_string(),
            price,
            prev_close: prev,
            open: fnum(&f, 5),
            high: fnum(&f, 33),
            low: fnum(&f, 34),
            change,
            pct: change / prev * 100.0,
            volume,
            amount,
            status: compute_status(market, &time),
            time,
            source: "腾讯".into(),
        });
    }
    out
}

/// 新浪备用源。注意 A 股与港股字段顺序不同：
/// A 股  0 名称 1 开 2 昨收 3 最新 4 高 5 低 8 量(股) 9 额(元) 30 日期 31 时间
/// 港股  0 英文 1 中文 2 开 3 昨收 4 高 5 低 6 最新 11 额(元) 12 量(股) 17 日期 18 时间
fn parse_sina(text: &str) -> Vec<Quote> {
    let mut out = Vec::new();
    for raw in text.split(';') {
        let seg = raw.trim();
        let eq = match seg.find('=') {
            Some(i) => i,
            None => continue,
        };
        let head = &seg[..eq];
        let key = match head.rfind("hq_str_") {
            Some(p) => &head[p + 7..],
            None => continue,
        };
        let val = seg[eq + 1..].trim().trim_matches('"');
        if val.is_empty() {
            continue;
        }
        let f: Vec<&str> = val.split(',').collect();
        let is_hk = key.starts_with("hk");
        let q = if is_hk {
            if f.len() < 19 {
                continue;
            }
            let price = fnum(&f, 6);
            let prev = fnum(&f, 3);
            if price <= 0.0 || prev <= 0.0 {
                continue;
            }
            let time = f.get(18).map(|s| s.trim().to_string()).unwrap_or_default();
            let change = price - prev;
            Quote {
                symbol: key.to_string(),
                name: f.get(1).unwrap_or(&"").to_string(),
                price,
                prev_close: prev,
                open: fnum(&f, 2),
                high: fnum(&f, 4),
                low: fnum(&f, 5),
                change,
                pct: change / prev * 100.0,
                volume: fnum(&f, 12),
                amount: fnum(&f, 11),
                status: compute_status("HK", &time),
                time,
                source: "新浪".into(),
            }
        } else {
            if f.len() < 32 {
                continue;
            }
            let price = fnum(&f, 3);
            let prev = fnum(&f, 2);
            if price <= 0.0 || prev <= 0.0 {
                continue;
            }
            let time = f.get(31).map(|s| s.trim().to_string()).unwrap_or_default();
            let change = price - prev;
            Quote {
                symbol: key.to_string(),
                name: f.get(0).unwrap_or(&"").to_string(),
                price,
                prev_close: prev,
                open: fnum(&f, 1),
                high: fnum(&f, 4),
                low: fnum(&f, 5),
                change,
                pct: change / prev * 100.0,
                volume: fnum(&f, 8),
                amount: fnum(&f, 9),
                status: compute_status("CN", &time),
                time,
                source: "新浪".into(),
            }
        };
        out.push(q);
    }
    out
}

fn fetch_tencent(symbols: &[String]) -> Result<Vec<Quote>, String> {
    let mut out = Vec::new();
    for chunk in symbols.chunks(60) {
        let url = format!("https://qt.gtimg.cn/q={}", chunk.join(","));
        let text = http_get(&url, "https://gu.qq.com/", 6000)?;
        out.extend(parse_tencent(&text));
    }
    if out.is_empty() {
        return Err("腾讯接口返回空数据".into());
    }
    Ok(out)
}

fn fetch_sina(symbols: &[String]) -> Result<Vec<Quote>, String> {
    let mut out = Vec::new();
    for chunk in symbols.chunks(60) {
        let url = format!("https://hq.sinajs.cn/list={}", chunk.join(","));
        let text = http_get(&url, "https://finance.sina.com.cn", 6000)?;
        out.extend(parse_sina(&text));
    }
    if out.is_empty() {
        return Err("新浪接口返回空数据".into());
    }
    Ok(out)
}

/// 主源失败自动切备用源；两个都失败才返回错误，由上层用缓存兜底。
pub fn fetch(symbols: &[String]) -> Result<Vec<Quote>, String> {
    if symbols.is_empty() {
        return Ok(Vec::new());
    }
    match fetch_tencent(symbols) {
        Ok(v) => Ok(v),
        Err(e1) => match fetch_sina(symbols) {
            Ok(v) => Ok(v),
            Err(e2) => Err(format!("腾讯: {} / 新浪: {}", e1, e2)),
        },
    }
}

/// 把 smartbox 返回的 `\uXXXX` 字面量还原成字符。
fn unescape_unicode(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 5 < chars.len() && chars[i + 1] == 'u' {
            let hex: String = chars[i + 2..i + 6].iter().collect();
            if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                if let Some(c) = char::from_u32(cp) {
                    out.push(c);
                    i += 6;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn kind_of(t: &str) -> Option<&'static str> {
    if t.starts_with("GP") {
        Some("stock")
    } else if t.starts_with("JJ") || t.starts_with("KJ") {
        Some("etf")
    } else if t.starts_with("ZS") {
        Some("index")
    } else {
        None
    }
}

/// 代码/名称/拼音联想。失败时返回空列表，前端仍允许用户直接输入代码添加。
pub fn search(query: &str) -> Vec<SearchHit> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let text = match ureq::get("https://smartbox.gtimg.cn/s3/")
        .query("q", q)
        .query("t", "all")
        .query("c", "1")
        .set("User-Agent", UA)
        .set("Referer", "https://gu.qq.com/")
        .timeout(Duration::from_millis(4000))
        .call()
    {
        Ok(r) => {
            let mut buf: Vec<u8> = Vec::new();
            if r.into_reader().take(512 * 1024).read_to_end(&mut buf).is_err() {
                return Vec::new();
            }
            let (t, _, _) = GBK.decode(&buf);
            unescape_unicode(&t.into_owned())
        }
        Err(_) => return Vec::new(),
    };

    let start = match text.find('"') {
        Some(i) => i + 1,
        None => return Vec::new(),
    };
    let end = text.rfind('"').unwrap_or(text.len());
    if end <= start {
        return Vec::new();
    }
    let body = &text[start..end];

    let mut hits: Vec<SearchHit> = Vec::new();
    for item in body.split('^') {
        let p: Vec<&str> = item.split('~').collect();
        if p.len() < 5 {
            continue;
        }
        let market = p[0];
        if !matches!(market, "sh" | "sz" | "hk" | "bj") {
            continue;
        }
        let kind = match kind_of(p[4]) {
            Some(k) => k,
            None => continue,
        };
        let code = p[1].to_string();
        let name = p[2].to_string();
        if code.is_empty() || name.is_empty() {
            continue;
        }
        if hits.iter().any(|h| h.code == code && h.market == market) {
            continue;
        }
        hits.push(SearchHit {
            symbol: format!("{}{}", market, code),
            code,
            name,
            market: market.to_uppercase(),
            kind: kind.to_string(),
        });
        if hits.len() >= 25 {
            break;
        }
    }
    hits
}

/// 手动输入代码时，用它反查名称；查不到就返回 None。
pub fn lookup_name(symbol: &str) -> Option<(String, String)> {
    let list = vec![symbol.to_string()];
    match fetch(&list) {
        Ok(v) => v.first().map(|q| (q.name.clone(), {
            // 用价格量级粗略区分为 ETF/股票，仅用于展示图标。
            if q.price < 10.0 { "etf".to_string() } else { "stock".to_string() }
        })),
        Err(_) => None,
    }
}

/// 把用户输入（600519 / sh600519 / 00700）规范化为内部 symbol。
pub fn normalize_symbol(input: &str) -> Option<String> {
    let s = input.trim().to_lowercase();
    if s.is_empty() {
        return None;
    }
    if s.starts_with("sh") || s.starts_with("sz") || s.starts_with("hk") || s.starts_with("bj") {
        let code: String = s.chars().skip(2).collect();
        if code.len() >= 4 && code.chars().all(|c| c.is_ascii_digit()) {
            return Some(format!("{}{}", &s[..2], code));
        }
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if s.len() == 5 {
        return Some(format!("hk{}", s));
    }
    if s.len() != 6 {
        return None;
    }
    let head = &s[..3];
    let m = match head {
        "600" | "601" | "603" | "605" | "688" | "689" | "510" | "511" | "512" | "513" | "515"
        | "516" | "518" | "588" | "900" => "sh",
        "000" | "001" | "002" | "003" | "300" | "301" | "159" | "150" | "161" | "162" | "163"
        | "165" | "166" | "168" | "169" | "200" => "sz",
        "430" | "830" | "831" | "832" | "833" | "834" | "835" | "836" | "837" | "838" | "839"
        | "870" | "871" | "872" | "873" | "874" | "875" | "876" | "877" | "920" => "bj",
        _ => "sh",
    };
    Some(format!("{}{}", m, s))
}

pub fn price_decimals(symbol: &str) -> usize {
    let m = market_of(symbol);
    if m == "HK" {
        3
    } else {
        2
    }
}

/// 个股详情：一次请求同时拿到行情、五档盘口和估值指标。
/// 港股与 A 股字段位置一致，越界统一按 0 处理，保证任何一只都能渲染。
pub fn fetch_detail(symbol: &str) -> Result<Detail, String> {
    let sym = symbol.trim().to_lowercase();
    let url = format!("https://qt.gtimg.cn/q={}", sym);
    let text = http_get(&url, "https://gu.qq.com/", 6000)?;

    let quote = parse_tencent(&text)
        .into_iter()
        .next()
        .ok_or_else(|| "无法解析该标的行情".to_string())?;

    let seg = text
        .split(';')
        .find(|x| x.trim().starts_with("v_"))
        .ok_or_else(|| "接口返回为空".to_string())?;
    let eq = seg.find('=').ok_or_else(|| "接口格式异常".to_string())?;
    let val = seg[eq + 1..].trim().trim_matches('"');
    let f: Vec<&str> = val.split('~').collect();

    let levels = |start: usize| -> Vec<Level> {
        let mut out = Vec::with_capacity(5);
        for k in 0..5 {
            let price = fnum(&f, start + k * 2);
            let volume = fnum(&f, start + k * 2 + 1);
            if price > 0.0 {
                out.push(Level { price, volume });
            }
        }
        out
    };

    Ok(Detail {
        turnover: fnum(&f, 38),
        pe: fnum(&f, 39),
        amplitude: fnum(&f, 43),
        float_cap: fnum(&f, 44) * 1e8,
        market_cap: fnum(&f, 45) * 1e8,
        pb: fnum(&f, 46),
        limit_up: fnum(&f, 47),
        limit_down: fnum(&f, 48),
        bids: levels(9),
        asks: levels(19),
        quote,
    })
}

/// 当日分时。返回 HH:MM + 价格，前端据此画走势图。
pub fn fetch_minute(symbol: &str) -> Result<Vec<MinutePoint>, String> {
    let sym = symbol.trim().to_lowercase();
    let url = format!(
        "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={}",
        sym
    );
    let text = http_get(&url, "https://gu.qq.com/", 6000)?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("分时数据解析失败: {}", e))?;

    let arr = v
        .get("data")
        .and_then(|d| d.get(&sym))
        .and_then(|d| d.get("data"))
        .and_then(|d| d.get("data"))
        .and_then(|d| d.as_array())
        .ok_or_else(|| "该标的暂无分时数据".to_string())?;

    let mut out: Vec<MinutePoint> = Vec::with_capacity(arr.len());
    let mut cum_vol = 0.0_f64;
    let mut cum_amt = 0.0_f64;
    for item in arr {
        if let Some(s) = item.as_str() {
            let parts: Vec<&str> = s.split(' ').collect();
            if parts.len() < 2 {
                continue;
            }
            let t = parts[0];
            let price = parts[1].parse::<f64>().unwrap_or(0.0);
            let vol = parts.get(2).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0);
            let amt = parts.get(3).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0);
            if t.len() != 4 || price <= 0.0 {
                continue;
            }
            // 接口给的是每分钟量（手）与额（元），累加成 VWAP 分子分母
            cum_vol += vol * 100.0;
            cum_amt += amt;
            let avg = if cum_vol > 0.0 { cum_amt / cum_vol } else { price };
            out.push(MinutePoint {
                t: format!("{}:{}", &t[0..2], &t[2..4]),
                price,
                avg,
            });
        }
    }
    if out.is_empty() {
        return Err("该标的暂无分时数据".into());
    }
    Ok(out)
}

/// 前复权 K 线。period 取 day / week / month，接口返回
/// [日期, 开, 收, 高, 低, 量]，数值可能是字符串也可能是数字，统一兼容。
pub fn fetch_kline(symbol: &str, period: &str, limit: usize) -> Result<Vec<Candle>, String> {
    let sym = symbol.trim().to_lowercase();
    let p = match period {
        "week" => "week",
        "month" => "month",
        _ => "day",
    };
    let n = limit.clamp(20, 400);
    let url = format!(
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={},{},,,{},qfq",
        sym, p, n
    );
    let text = http_get(&url, "https://gu.qq.com/", 8000)?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("K线数据解析失败: {}", e))?;

    let node = v
        .get("data")
        .and_then(|d| d.get(&sym))
        .ok_or_else(|| "该标的暂无K线数据".to_string())?;

    let key = format!("qfq{}", p);
    let arr = node
        .get(&key)
        .or_else(|| node.get(p))
        .and_then(|a| a.as_array())
        .ok_or_else(|| "该标的暂无K线数据".to_string())?;

    let num = |x: &serde_json::Value| -> f64 {
        x.as_f64()
            .or_else(|| x.as_str().and_then(|s| s.parse::<f64>().ok()))
            .unwrap_or(0.0)
    };

    let mut out: Vec<Candle> = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(a) = item.as_array() else { continue };
        if a.len() < 6 {
            continue;
        }
        let date = a[0].as_str().unwrap_or("").to_string();
        let close = num(&a[2]);
        if date.is_empty() || close <= 0.0 {
            continue;
        }
        out.push(Candle {
            date,
            open: num(&a[1]),
            close,
            high: num(&a[3]),
            low: num(&a[4]),
            volume: num(&a[5]),
        });
    }
    if out.is_empty() {
        return Err("该标的暂无K线数据".into());
    }
    Ok(out)
}
