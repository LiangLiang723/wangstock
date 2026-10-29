use serde::{Deserialize, Serialize};

/// 分组。`kind` 为 "watch"（自选分组）或 "industry"（行业分类）。
/// 两类共用同一张树，用 parent_id 自引用支持任意层级。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub sort: i64,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Instrument {
    pub symbol: String,
    pub code: String,
    pub market: String,
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "stock".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub group_id: String,
    pub symbol: String,
    pub sort: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub refresh_sec: u64,
    pub idle_refresh_sec: u64,
    pub flyout_group: Option<String>,
    pub flyout_limit: usize,
    pub color_mode: String,
    pub show_amount: bool,
    pub show_range: bool,
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            refresh_sec: 3,
            idle_refresh_sec: 15,
            flyout_group: None,
            flyout_limit: 10,
            color_mode: "cn".into(),
            show_amount: true,
            show_range: true,
            close_to_tray: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub version: u32,
    pub groups: Vec<Group>,
    pub instruments: Vec<Instrument>,
    pub members: Vec<Member>,
    pub settings: Settings,
}

impl Default for Data {
    fn default() -> Self {
        let mut groups = Vec::new();
        let mut instruments = Vec::new();
        let mut members = Vec::new();

        // 首次启动的示例数据：让界面不是空的，用户可一键删除。
        groups.push(Group {
            id: "g_core".into(),
            name: "核心持仓".into(),
            kind: "watch".into(),
            parent_id: None,
            sort: 1,
            collapsed: false,
            color: None,
        });
        groups.push(Group {
            id: "g_etf".into(),
            name: "宽基 ETF".into(),
            kind: "watch".into(),
            parent_id: None,
            sort: 2,
            collapsed: false,
            color: None,
        });
        groups.push(Group {
            id: "g_game".into(),
            name: "游戏传媒".into(),
            kind: "watch".into(),
            parent_id: None,
            sort: 0,
            collapsed: false,
            color: None,
        });
        groups.push(Group {
            id: "g_tech".into(),
            name: "科技".into(),
            kind: "industry".into(),
            parent_id: None,
            sort: 0,
            collapsed: false,
            color: Some("#6ea8ff".into()),
        });
        groups.push(Group {
            id: "g_semi".into(),
            name: "半导体".into(),
            kind: "industry".into(),
            parent_id: Some("g_tech".into()),
            sort: 0,
            collapsed: false,
            color: Some("#b48cf2".into()),
        });
        groups.push(Group {
            id: "g_energy".into(),
            name: "新能源".into(),
            kind: "industry".into(),
            parent_id: None,
            sort: 1,
            collapsed: false,
            color: Some("#4fbf8b".into()),
        });

        let seed = [
            ("sh600519", "600519", "SH", "贵州茅台", "stock"),
            ("sz300750", "300750", "SZ", "宁德时代", "stock"),
            ("hk00700", "00700", "HK", "腾讯控股", "stock"),
            ("sh510300", "510300", "SH", "沪深300ETF", "etf"),
            ("sz159915", "159915", "SZ", "创业板ETF", "etf"),
            ("sz002602", "002602", "SZ", "世纪华通", "stock"),
            ("sz159869", "159869", "SZ", "游戏ETF", "etf"),
        ];
        for (i, (sym, code, market, name, kind)) in seed.iter().enumerate() {
            instruments.push(Instrument {
                symbol: sym.to_string(),
                code: code.to_string(),
                market: market.to_string(),
                name: name.to_string(),
                kind: kind.to_string(),
            });
            let _ = i;
        }

        let core = ["sh600519", "sz300750", "hk00700"];
        for (i, s) in core.iter().enumerate() {
            members.push(Member {
                group_id: "g_core".into(),
                symbol: s.to_string(),
                sort: i as i64,
            });
        }
        let etf = ["sh510300", "sz159915"];
        for (i, s) in etf.iter().enumerate() {
            members.push(Member {
                group_id: "g_etf".into(),
                symbol: s.to_string(),
                sort: i as i64,
            });
        }
        let game = ["sz002602", "sz159869"];
        for (i, s) in game.iter().enumerate() {
            members.push(Member {
                group_id: "g_game".into(),
                symbol: s.to_string(),
                sort: i as i64,
            });
        }
        members.push(Member {
            group_id: "g_semi".into(),
            symbol: "sz300750".into(),
            sort: 0,
        });

        Self {
            version: 1,
            groups,
            instruments,
            members,
            settings: Settings::default(),
        }
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub prev_close: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub change: f64,
    pub pct: f64,
    pub volume: f64,
    pub amount: f64,
    pub time: String,
    pub status: String,
    pub source: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub market: String,
    pub kind: String,
}

pub fn market_of(symbol: &str) -> &'static str {
    if symbol.starts_with("hk") {
        "HK"
    } else if symbol.starts_with("sh") {
        "SH"
    } else if symbol.starts_with("sz") {
        "SZ"
    } else if symbol.starts_with("bj") {
        "BJ"
    } else {
        "SZ"
    }
}

pub fn code_of(symbol: &str) -> String {
    symbol.chars().skip(2).collect()
}

/// 五档盘口的一档
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    pub price: f64,
    pub volume: f64,
}

/// 个股详情：行情快照 + 估值指标 + 盘口
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub quote: Quote,
    pub turnover: f64,
    pub pe: f64,
    pub pb: f64,
    pub amplitude: f64,
    pub market_cap: f64,
    pub float_cap: f64,
    pub limit_up: f64,
    pub limit_down: f64,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

/// 分时图上的一個点
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MinutePoint {
    pub t: String,
    pub price: f64,
    /// 当日累计成交均价（VWAP）
    pub avg: f64,
}

/// 一根 K 线（前复权）
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    pub date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
}
