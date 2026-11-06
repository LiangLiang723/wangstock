/* 数据选择与格式化：纯函数，无 DOM 副作用，便于单独复用与测试。 */
import { state } from './core.js';

export const STATUS_TEXT = { live: '实时', delayed: '延迟', closed: '收盘', stale: '缓存' };
export const cssVar = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();

/* ---------- 数据选择 ---------- */
export function groupById(id) {
  return (state.data?.groups || []).find((g) => g.id === id);
}
export function instrument(sym) {
  return (state.data?.instruments || []).find((i) => i.symbol === sym) || {
    name: sym, code: String(sym).slice(2), market: String(sym).slice(0, 2).toUpperCase(),
  };
}
export function watchIds() {
  return new Set((state.data?.groups || []).filter((g) => g.kind === 'watch').map((g) => g.id));
}
export function firstWatchGroup() {
  const g = (state.data?.groups || []).filter((x) => x.kind === 'watch').sort((a, b) => a.sort - b.sort)[0];
  return g ? g.id : null;
}
export function countOf(gid) {
  return (state.data?.members || []).filter((m) => m.groupId === gid).length;
}

/** 当前视图的标顺序。『全部自选』用全局 order，分组用成员 sort。 */
export function currentSymbols() {
  if (!state.data) return [];
  if (state.group === 'all') {
    const watch = watchIds();
    const valid = new Set(state.data.members.filter((m) => watch.has(m.groupId)).map((m) => m.symbol));
    const seen = new Set();
    const out = [];
    (state.data.order || []).forEach((sym) => {
      if (valid.has(sym) && !seen.has(sym)) { seen.add(sym); out.push(sym); }
    });
    const groups = state.data.groups.filter((g) => g.kind === 'watch').sort((a, b) => a.sort - b.sort);
    for (const g of groups) {
      state.data.members.filter((m) => m.groupId === g.id).sort((a, b) => a.sort - b.sort)
        .forEach((m) => { if (!seen.has(m.symbol)) { seen.add(m.symbol); out.push(m.symbol); } });
    }
    return out;
  }
  return state.data.members.filter((m) => m.groupId === state.group)
    .sort((a, b) => a.sort - b.sort).map((m) => m.symbol);
}

/* ---------- 数字 ---------- */
export const DEC = (sym) => (instrument(sym)?.kind === 'etf' || String(sym).startsWith('hk')) ? 3 : 2;
export const pctCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
export const fmtPrice = (v, d) => (v == null || v === 0 ? '—' : v.toFixed(d));
export const fmtChg = (v, d) => (v == null || v === 0 ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
export const fmtPct = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
export const fmtN = (v, d) => (v == null || v === 0 ? '—' : v.toFixed(d));
export function fmtAmt(v) {
  if (!v) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return Math.round(v).toLocaleString();
}
export function fmtVol(v) {
  if (!v) return '—';
  const lots = v / 100;
  if (lots >= 1e8) return (lots / 1e8).toFixed(2) + '亿手';
  if (lots >= 1e4) return (lots / 1e4).toFixed(2) + '万手';
  return Math.round(lots).toLocaleString() + '手';
}
export function fmtCap(v) {
  if (!v) return '—';
  return (v >= 1e12 ? (v / 1e12).toFixed(2) + '万亿' : (v / 1e8).toFixed(2) + '亿');
}
export function fmtClock(d) {
  if (!d) return '--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* ---------- 图表 ---------- */
export function sparkSvg(data, prev) {
  if (!data || data.length < 2) return '';
  const W = 60, H = 18, P = 1;
  let min = Math.min.apply(null, data), max = Math.max.apply(null, data);
  if (prev) { min = Math.min(min, prev); max = Math.max(max, prev); }
  if (max - min < 1e-9) max = min + 0.01;
  const x = (i) => P + (i / (data.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - P * 2);
  let d = '';
  for (let i = 0; i < data.length; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(data[i]).toFixed(1);
  const col = prev ? (data[data.length - 1] >= prev ? cssVar('--pos') : cssVar('--neg')) : cssVar('--text-3');
  const base = prev ? '<line x1="0" y1="' + y(prev).toFixed(1) + '" x2="' + W + '" y2="' + y(prev).toFixed(1) + '" stroke="#333a47" stroke-width=".8"/>' : '';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + base +
    '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.2"/></svg>';
}

/** 分时：价格线 + 均价线 + 昨收基准。 */
export function minuteSvg(points, prev, rise) {
  const W = 720, H = 150, PX = 4, PY = 8;
  if (!points || points.length < 2) return '';
  const prices = points.map((p) => p.price);
  let lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
  if (prev) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
  // 均价只保留与价格同一量级的值；指数等标的没有有效均价，绝不能让它拉爆纵轴
  const avgOk = (a) => a > 0 && a > lo * 0.5 && a < hi * 2;
  const avgs = points.map((p) => (avgOk(p.avg) ? p.avg : null));
  const vals = prices.concat(avgs.filter((a) => a !== null));
  let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if (prev) { min = Math.min(min, prev); max = Math.max(max, prev); }
  if (max - min < 1e-9) max = min + 0.01;
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const n = points.length;
  const x = (i) => PX + (i / (n - 1)) * (W - PX * 2);
  const y = (v) => PY + ((max - v) / (max - min)) * (H - PY * 2);
  let line = '';
  for (let i = 0; i < n; i++) line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(points[i].price).toFixed(1);
  const area = line + 'L' + x(n - 1).toFixed(1) + ' ' + (H - PY) + 'L' + x(0).toFixed(1) + ' ' + (H - PY) + 'Z';
  const col = rise ? cssVar('--pos') : cssVar('--neg');
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = (PY + (i / 4) * (H - PY * 2)).toFixed(1);
    grid += '<line x1="' + PX + '" y1="' + gy + '" x2="' + (W - PX) + '" y2="' + gy + '" stroke="#242a35" stroke-width="1"/>';
  }
  const base = prev ? '<line x1="' + PX + '" y1="' + y(prev).toFixed(1) + '" x2="' + (W - PX) + '" y2="' + y(prev).toFixed(1) + '" stroke="#69748a" stroke-width="1" stroke-dasharray="3 4"/>' : '';
  let avg = '';
  if (avgs.some((a) => a !== null)) {
    let a = '', pen = false;
    for (let i = 0; i < n; i++) {
      if (avgs[i] === null) { pen = false; continue; }
      a += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(avgs[i]).toFixed(1);
      pen = true;
    }
    avg = '<path d="' + a + '" fill="none" stroke="#e0a34a" stroke-width="1" stroke-opacity=".9"/>';
  }
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + base +
    '<path d="' + area + '" fill="' + col + '" fill-opacity=".10" stroke="none"/>' +
    '<path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>' + avg + '</svg>';
}

/** 前复权 K 线：蜡烛 + 成交量 + MA5/10/20。all 为完整序列，view 是可见窗口。 */
export function klineSvg(all, start, count) {
  const W = 720, H = 150, PX = 4, PY = 6, volH = 32;
  const priceH = H - volH - 8;
  const s = Math.max(0, Math.min(start, Math.max(0, all.length - 1)));
  const candles = all.slice(s, s + count);
  const n = candles.length;
  if (n < 2) return '';
  let min = Infinity, max = -Infinity, maxV = 0;
  for (const c of candles) {
    min = Math.min(min, c.low); max = Math.max(max, c.high); maxV = Math.max(maxV, c.volume);
  }
  if (!isFinite(min) || max <= min) return '';
  const pad = (max - min) * 0.06;
  min -= pad; max += pad;
  const step = (W - PX * 2) / n;
  const bw = Math.max(1.4, step * 0.62);
  const x = (i) => PX + step * (i + 0.5);
  const y = (v) => PY + ((max - v) / (max - min)) * (priceH - PY);
  const yv = (v) => H - (maxV ? (v / maxV) * volH : 0);
  const upC = cssVar('--pos'), downC = cssVar('--neg');
  let bars = '';
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const col = c.close >= c.open ? upC : downC;
    const xc = x(i);
    bars += '<line x1="' + xc.toFixed(1) + '" y1="' + y(c.high).toFixed(1) + '" x2="' + xc.toFixed(1) + '" y2="' + y(c.low).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>';
    const top = Math.min(y(c.open), y(c.close));
    bars += '<rect x="' + (xc - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(c.close) - y(c.open))).toFixed(1) + '" fill="' + col + '"/>';
    bars += '<rect x="' + (xc - bw / 2).toFixed(1) + '" y="' + yv(c.volume).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(.5, H - yv(c.volume)).toFixed(1) + '" fill="' + col + '" fill-opacity=".5"/>';
  }
  const ma = (k, color) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      let sum = 0, ok = true;
      for (let j = 0; j < k; j++) {
        const idx = s + i - j;
        if (idx < 0) { ok = false; break; }
        sum += all[idx].close;
      }
      if (ok) pts.push(x(i).toFixed(1) + ' ' + y(sum / k).toFixed(1));
    }
    return pts.length > 1 ? '<polyline points="' + pts.join(',') + '" fill="none" stroke="' + color + '" stroke-width="1" stroke-opacity=".85"/>' : '';
  };
  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const gy = (PY + (i / 3) * (priceH - PY)).toFixed(1);
    grid += '<line x1="' + PX + '" y1="' + gy + '" x2="' + (W - PX) + '" y2="' + gy + '" stroke="#242a35" stroke-width="1"/>';
  }
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + bars +
    ma(5, '#e0a34a') + ma(10, '#6aa8ff') + ma(20, '#b07ae0') + '</svg>';
}
