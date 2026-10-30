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
    /// 「全部自选」的全局顺序。分组内顺序仍由 Member.sort 决定，
    /// 两者独立：在哪个视图里拖，就只改那个视图的顺序。
    #[serde(default)]
    pub order: Vec<String>,
}

impl Data {
    /// 补全并清理全局顺序：去掉已不存在的标的、去重，
    /// 新加入的标的按分组顺序追加到末尾。
    pub fn normalize_order(&mut self) {
        let watched: Vec<String> = {
            let gids: Vec<String> = self
                .groups
                .iter()
                .filter(|g| g.kind == "watch")
                .map(|g| g.id.clone())
                .collect();
            let mut gs: Vec<&crate::model::Group> = self
                .groups
                .iter()
                .filter(|g| g.kind == "watch")
                .collect();
            gs.sort_by_key(|g| g.sort);
            let mut out = Vec::new();
            for g in gs {
                if !gids.contains(&g.id) {
                    continue;
                }
                let mut ms: Vec<&crate::model::Member> =
                    self.members.iter().filter(|m| m.group_id == g.id).collect();
                ms.sort_by_key(|m| m.sort);
                for m in ms {
                    out.push(m.symbol.clone());
                }
            }
            out
        };

        let mut seen = std::collections::HashSet::new();
        let mut next: Vec<String> = Vec::with_capacity(watched.len());
        for s in self.order.iter() {
            if watched.contains(s) && seen.insert(s.clone()) {
                next.push(s.clone());
            }
        }
        for s in watched {
            if seen.insert(s.clone()) {
                next.push(s);
            }
        }
        self.order = next;
    }

    /// 应用一次排序。`group_id == "all"` 改全局顺序，否则改分组内顺序。
    /// 抽成纯函数是为了能直接单测，不必启动窗口。
    pub fn apply_reorder(&mut self, group_id: &str, symbols: &[String]) {
        if group_id == "all" {
            let mut next: Vec<String> = symbols.to_vec();
            for s in self.order.iter() {
                if !next.contains(s) {
                    next.push(s.clone());
                }
            }
            self.order = next;
            self.normalize_order();
        } else {
            for (i, sym) in symbols.iter().enumerate() {
                if let Some(m) = self
                    .members
                    .iter_mut()
                    .find(|m| m.group_id == group_id && &m.symbol == sym)
                {
                    m.sort = i as i64;
                }
            }
            // 重新编号成 0..n-1，避免部分列表留下重复 sort 导致顺序不确定。
            let mut idx: Vec<usize> = self
                .members
                .iter()
                .enumerate()
                .filter(|(_, m)| m.group_id == group_id)
                .map(|(i, _)| i)
                .collect();
            idx.sort_by_key(|&i| (self.members[i].sort, i));
            for (pos, i) in idx.iter().enumerate() {
                self.members[*i].sort = pos as i64;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(group: &str, symbol: &str, sort: i64) -> Member {
        Member {
            group_id: group.into(),
            symbol: symbol.into(),
            sort,
        }
    }

    fn group(id: &str, sort: i64) -> Group {
        Group {
            id: id.into(),
            name: id.into(),
            kind: "watch".into(),
            parent_id: None,
            sort,
            collapsed: false,
            color: None,
        }
    }

    fn sample() -> Data {
        Data {
            version: 1,
            groups: vec![group("g1", 0), group("g2", 1)],
            instruments: Vec::new(),
            members: vec![
                member("g1", "a", 0),
                member("g1", "b", 1),
                member("g1", "c", 2),
                member("g2", "d", 0),
                member("g2", "e", 1),
            ],
            settings: Settings::default(),
            order: Vec::new(),
        }
    }

    fn group_order(d: &Data, gid: &str) -> Vec<String> {
        let mut ms: Vec<&Member> = d.members.iter().filter(|m| m.group_id == gid).collect();
        ms.sort_by_key(|m| m.sort);
        ms.iter().map(|m| m.symbol.clone()).collect()
    }

    #[test]
    fn normalize_fills_order_in_group_sequence() {
        let mut d = sample();
        d.normalize_order();
        assert_eq!(d.order, vec!["a", "b", "c", "d", "e"]);
    }

    #[test]
    fn reorder_all_moves_item_to_front() {
        let mut d = sample();
        d.normalize_order();
        let next = vec!["e".to_string(), "a".into(), "b".into(), "c".into(), "d".into()];
        d.apply_reorder("all", &next);
        assert_eq!(d.order, vec!["e", "a", "b", "c", "d"]);
        // 分组内顺序不应被改动
        assert_eq!(group_order(&d, "g1"), vec!["a", "b", "c"]);
    }

    #[test]
    fn reorder_group_writes_member_sort_only() {
        let mut d = sample();
        d.normalize_order();
        let before = d.order.clone();
        let next = vec!["c".to_string(), "a".into(), "b".into()];
        d.apply_reorder("g1", &next);
        assert_eq!(group_order(&d, "g1"), vec!["c", "a", "b"]);
        assert_eq!(d.order, before, "分组内排序不应影响全部视图");
    }

    #[test]
    fn reorder_group_ignores_unknown_symbol() {
        let mut d = sample();
        let next = vec!["zzz".to_string(), "b".into()];
        d.apply_reorder("g1", &next);
        // zzz 被忽略，不产生新成员；b 落在第 2 位
        assert_eq!(d.members.len(), 5);
        assert_eq!(group_order(&d, "g1"), vec!["a", "b", "c"]);
    }

    #[test]
    fn reorder_group_keeps_sort_contiguous() {
        let mut d = sample();
        let next = vec!["c".to_string(), "b".into(), "a".into()];
        d.apply_reorder("g1", &next);
        let mut sorts: Vec<i64> = d
            .members
            .iter()
            .filter(|m| m.group_id == "g1")
            .map(|m| m.sort)
            .collect();
        sorts.sort();
        assert_eq!(sorts, vec![0, 1, 2]);
    }

    #[test]
    fn normalize_drops_stale_and_keeps_custom_order() {
        let mut d = sample();
        d.order = vec!["d".into(), "gone".into(), "b".into(), "b".into()];
        d.normalize_order();
        assert_eq!(d.order, vec!["d", "b", "a", "c", "e"]);
    }
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

        let mut d = Self {
            version: 1,
            groups,
            instruments,
            members,
            settings: Settings::default(),
            order: Vec::new(),
        };
        d.normalize_order();
        d
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
