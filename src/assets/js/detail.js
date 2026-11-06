/* 详情层：聚焦视图。价格 → 图表 → 指标 → 盘口，按扫视顺序组织。 */
import { $, esc, state, actions, api, toast } from './core.js';
import {
  instrument, DEC, pctCls, fmtPrice, fmtChg, fmtPct, fmtN, fmtAmt, fmtVol, fmtCap,
  STATUS_TEXT, minuteSvg, klineSvg, fmtClock,
} from './format.js';

const PERIODS = [{ k: 'minute', t: '分时' }, { k: 'day', t: '日K' }, { k: 'week', t: '周K' }, { k: 'month', t: '月K' }];
const DS = { sym: null, data: null, minute: [], minuteAt: 0, period: 'minute', kline: {}, kview: { start: 0, count: 120 } };

export function openDetail(sym) {
  const changed = DS.sym !== sym;
  DS.sym = sym;
  if (changed) {
    DS.data = null; DS.minute = []; DS.minuteAt = 0;
    DS.period = 'minute'; DS.kline = {}; DS.kview = { start: 0, count: 120 };
  }
  state.view = 'detail';
  state.detailSym = sym;
  const pane = $('detail');
  pane.innerHTML = '<div class="detail"><div class="chart-empty">加载行情…</div></div>';
  actions.renderHeadInfo && actions.renderHeadInfo();
  refreshDetail(true);
}

export function closeDetail() {
  state.view = 'list';
  state.detailSym = null;
  DS.sym = null;
  $('detail').innerHTML = '';
  actions.renderHeadInfo && actions.renderHeadInfo();
  actions.renderList && actions.renderList();
}

export async function refreshDetail(withMinute) {
  const sym = state.detailSym;
  if (!sym) return;
  try {
    const d = await api.detail(sym);
    if (state.detailSym !== sym) return;
    DS.data = d;
    let chartDirty = false;
    if (DS.period === 'minute' && (withMinute || Date.now() - DS.minuteAt > 20000)) {
      try {
        DS.minute = await api.minute(sym);
        DS.minuteAt = Date.now();
        chartDirty = true;
      } catch (e) { if (!DS.minute.length) DS.minute = []; }
    }
    if (DS.data && $('dPrice')) {
      updateHero();
      if (chartDirty) renderChartOnly();
    } else renderDetail();
  } catch (e) {
    if (state.detailSym === sym) {
      $('detail').innerHTML = '<div class="detail"><div class="error-state"><span class="msg">行情加载失败：' + esc(String(e)) + '</span>' +
        '<button class="btn" id="dRetry">重试</button></div></div>';
      const b = $('dRetry');
      if (b) b.onclick = () => refreshDetail(true);
    }
  }
}

function chartData() {
  if (DS.period === 'minute') return { points: DS.minute, candles: [] };
  const all = DS.kline[DS.period];
  if (all === undefined) return { loading: true, points: [], candles: [] };
  const start = Math.max(0, Math.min(DS.kview.start, Math.max(0, all.length - 1)));
  const count = Math.max(20, Math.min(DS.kview.count, all.length));
  return { points: [], candles: all.slice(start, start + count), all, start, count };
}

function chartInner(q, dec) {
  if (DS.period === 'minute') {
    const svg = minuteSvg(DS.minute, q.prevClose, q.pct >= 0);
    if (!svg) return '<div class="chart-empty">暂无分时数据</div>';
    const axis = DS.minute.length
      ? '<div class="chart-axis"><span>' + DS.minute[0].t + '</span><span>' +
        DS.minute[Math.floor(DS.minute.length / 2)].t + '</span><span>' + DS.minute[DS.minute.length - 1].t + '</span></div>'
      : '';
    return '<div class="chart-body" id="chartBody">' + svg + axis +
      '<div class="cx-line" id="cxLine"></div><div class="cx-tip" id="cxTip"></div></div>';
  }
  const c = chartData();
  if (c.loading) return '<div class="chart-empty">加载 K 线…</div>';
  const svg = klineSvg(c.all, c.start, c.count);
  if (!svg) return '<div class="chart-empty">暂无 K 线数据</div>';
  const first = c.candles[0]?.date || '';
  const last = c.candles[c.candles.length - 1]?.date || '';
  return '<div class="chart-body" id="chartBody">' + svg +
    '<div class="chart-axis"><span>' + esc(first) + '</span><span>' + esc(last) + '</span></div>' +
    '<div class="cx-line" id="cxLine"></div><div class="cx-tip" id="cxTip"></div></div>';
}

function cellsHtml(q) {
  const d = DS.data;
  const dec = DEC(q.symbol);
  const cells = [
    ['今开', fmtN(q.open, dec), q.open >= q.prevClose ? 'up' : 'down'],
    ['昨收', fmtN(q.prevClose, dec), ''],
    ['最高', fmtN(q.high, dec), 'up'],
    ['最低', fmtN(q.low, dec), 'down'],
    ['成交量', fmtVol(q.volume), ''],
    ['成交额', fmtAmt(q.amount), ''],
    ['振幅', d.amplitude ? d.amplitude.toFixed(2) + '%' : '—', ''],
    ['换手率', d.turnover ? d.turnover.toFixed(2) + '%' : '—', ''],
    ['市盈率 TTM', d.pe ? d.pe.toFixed(2) : '—', ''],
    ['市净率', d.pb ? d.pb.toFixed(2) : '—', ''],
    ['总市值', fmtCap(d.marketCap), ''],
    ['流通市值', fmtCap(d.floatCap), ''],
    ['涨停价', fmtN(d.limitUp, dec), 'up'],
    ['跌停价', fmtN(d.limitDown, dec), 'down'],
  ];
  return cells.map((c) => '<div class="d-cell"><span class="k">' + c[0] + '</span>' +
    '<span class="v ' + c[2] + '">' + c[1] + '</span></div>').join('');
}

function bookHtml(q) {
  const d = DS.data;
  const dec = DEC(q.symbol);
  const lv = (list, prefix) => list.map((l, i) => {
    const cls = l.price >= q.prevClose ? 'up' : 'down';
    return '<div class="lv"><span class="s">' + prefix + (i + 1) + '</span>' +
      '<span class="p ' + cls + '">' + l.price.toFixed(dec) + '</span>' +
      '<span class="q">' + Math.round(l.volume).toLocaleString() + '</span></div>';
  }).join('');
  const asks = (d.asks || []).slice().reverse();
  const bids = d.bids || [];
  if (!asks.length && !bids.length) {
    return '<h3>五档盘口</h3><div style="padding:10px;font-size:11px;color:var(--text-3)">该标的暂无盘口数据</div>';
  }
  return '<h3>五档盘口</h3>' + lv(asks, '卖') + '<div class="lv-sep"></div>' + lv(bids, '买');
}

export function renderDetail() {
  const d = DS.data;
  if (!d) return;
  const q = d.quote;
  const ins = instrument(q.symbol);
  const dec = DEC(q.symbol);
  const cls = pctCls(q.pct);
  const note = DS.period === 'minute' ? '昨收 ' + fmtN(q.prevClose, dec) : '前复权 · MA5/10/20 · 滚轮缩放 / 拖拽平移';
  $('detail').innerHTML =
    '<div class="detail">' +
    '<div class="d-nav">' +
    '<button class="btn tiny" id="dBack">← 返回列表</button>' +
    '<button class="btn tiny" id="dPrev">↑ 上一只</button>' +
    '<button class="btn tiny" id="dNext">↓ 下一只</button>' +
    '<span class="hint">Esc 返回 · ↑↓ 切换个股</span></div>' +
    '<div class="d-top"><div class="d-id"><h2>' + esc(ins.name) + '</h2>' +
    '<span>' + esc(ins.code) + ' · ' + esc(ins.market) + '</span></div>' +
    '<span class="spacer"></span><span class="tag js-dtag ' + q.status + '">' + (STATUS_TEXT[q.status] || q.status) + '</span></div>' +
    '<div class="d-hero"><span class="d-price ' + cls + '" id="dPrice">' + fmtPrice(q.price, dec) + '</span>' +
    '<span class="d-change"><span class="js-dchg ' + cls + '">' + fmtChg(q.change, dec) + '</span>' +
    '<span class="js-dpct ' + cls + '">' + fmtPct(q.pct) + '</span></span>' +
    '<span class="d-meta js-dmeta">' + esc(q.time) + ' · ' + esc(q.source) + '</span></div>' +
    '<div class="panel" style="margin-top:12px"><div class="panel-head">' +
    '<div class="chart-tabs" id="chartTabs">' + PERIODS.map((p) =>
      '<button data-p="' + p.k + '"' + (DS.period === p.k ? ' class="on"' : '') + '>' + p.t + '</button>').join('') + '</div>' +
    '<span class="spacer"></span><span class="note">' + note + '</span>' +
    '<div class="chart-tools"><button class="iconbtn" id="zoomOut" title="缩小">−</button>' +
    '<button class="iconbtn" id="zoomIn" title="放大">＋</button>' +
    '<button class="iconbtn" id="zoomReset" title="复位">⟲</button></div></div>' +
    '<div id="chartSlot">' + chartInner(q, dec) + '</div></div>' +
    '<div class="d-cols"><div class="d-grid" id="dGrid">' + cellsHtml(q) + '</div>' +
    '<div class="d-book" id="dBook">' + bookHtml(q) + '</div></div></div>';
  bindDetailButtons();
}

function updateHero() {
  const q = DS.data.quote;
  const dec = DEC(q.symbol);
  const cls = pctCls(q.pct);
  const set = (sel, text, className) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.textContent = text;
    if (className != null) el.className = className;
  };
  set('#dPrice', fmtPrice(q.price, dec), 'd-price ' + cls);
  set('.js-dchg', fmtChg(q.change, dec), 'js-dchg ' + cls);
  set('.js-dpct', fmtPct(q.pct), 'js-dpct ' + cls);
  set('.js-dmeta', q.time + ' · ' + q.source);
  set('.js-dtag', STATUS_TEXT[q.status] || q.status, 'tag js-dtag ' + q.status);
  const grid = $('dGrid');
  if (grid) grid.innerHTML = cellsHtml(q);
  const book = $('dBook');
  if (book) book.innerHTML = bookHtml(q);
}

function renderChartOnly() {
  if (!DS.data) return;
  const slot = $('chartSlot');
  if (slot) slot.innerHTML = chartInner(DS.data.quote, DEC(DS.data.quote.symbol));
}

function resetKview() {
  const all = DS.kline[DS.period] || [];
  DS.kview.count = Math.min(120, Math.max(20, all.length));
  DS.kview.start = Math.max(0, all.length - DS.kview.count);
}

async function switchPeriod(p) {
  DS.period = p;
  DS.kview = { start: 0, count: 120 };
  if (p !== 'minute' && DS.kline[p] === undefined) {
    renderDetail();
    try {
      DS.kline[p] = await api.kline(DS.sym, p, p === 'day' ? 160 : 90);
    } catch (e) { DS.kline[p] = []; }
    resetKview();
  } else if (p !== 'minute') {
    resetKview();
  } else if (Date.now() - DS.minuteAt > 20000) {
    try { DS.minute = await api.minute(DS.sym); DS.minuteAt = Date.now(); } catch (e) { /* 保留旧数据 */ }
  }
  renderDetail();
}

function zoom(factor) {
  const all = DS.kline[DS.period] || [];
  if (!all.length || DS.period === 'minute') return;
  const v = DS.kview;
  const old = v.count;
  const next = Math.max(25, Math.min(all.length, Math.round(old * factor)));
  if (next === old) return;
  const center = v.start + old / 2;
  v.count = next;
  v.start = Math.max(0, Math.min(all.length - next, Math.round(center - next / 2)));
  renderChartOnly();
}

function bindDetailButtons() {
  const back = $('dBack');
  if (back) back.onclick = () => actions.closeDetail && actions.closeDetail();
  const prev = $('dPrev'), next = $('dNext');
  if (prev) prev.onclick = () => actions.stepDetail && actions.stepDetail(-1);
  if (next) next.onclick = () => actions.stepDetail && actions.stepDetail(1);
  const tabs = $('chartTabs');
  if (tabs) tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => switchPeriod(b.dataset.p); });
  const zi = $('zoomIn'), zo = $('zoomOut'), zr = $('zoomReset');
  if (zi) zi.onclick = () => zoom(0.8);
  if (zo) zo.onclick = () => zoom(1.25);
  if (zr) zr.onclick = () => { resetKview(); renderChartOnly(); };
}

/** 图表交互：滚轮缩放（以光标为锚）、拖拽平移、双击复位、十字光标。 */
export function bindDetail() {
  const pane = $('detail');

  pane.addEventListener('wheel', (e) => {
    const body = e.target.closest('#chartBody');
    if (!body || DS.period === 'minute') return;
    const all = DS.kline[DS.period] || [];
    if (all.length < 30) return;
    e.preventDefault();
    const v = DS.kview, old = v.count;
    const next = Math.max(25, Math.min(all.length, Math.round(old * (e.deltaY > 0 ? 1.16 : 0.86))));
    if (next === old) return;
    const rect = body.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const anchor = v.start + old * ratio;
    v.count = next;
    v.start = Math.max(0, Math.min(all.length - next, Math.round(anchor - next * ratio)));
    renderChartOnly();
  }, { passive: false });

  pane.addEventListener('mousedown', (e) => {
    const body = e.target.closest('#chartBody');
    if (!body || e.button !== 0 || DS.period === 'minute') return;
    e.preventDefault();
    const rect = body.getBoundingClientRect();
    const x0 = e.clientX, s0 = DS.kview.start;
    const pxPerBar = rect.width / DS.kview.count;
    const total = (DS.kline[DS.period] || []).length;
    const onMove = (ev) => {
      const ns = Math.max(0, Math.min(total - DS.kview.count, s0 + Math.round((x0 - ev.clientX) / pxPerBar)));
      if (ns !== DS.kview.start) { DS.kview.start = ns; renderChartOnly(); }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  pane.addEventListener('dblclick', (e) => {
    if (!e.target.closest('#chartBody') || DS.period === 'minute') return;
    resetKview();
    renderChartOnly();
  });

  pane.addEventListener('mousemove', (e) => {
    const body = e.target.closest('#chartBody');
    const line = $('cxLine'), tip = $('cxTip');
    if (!body || !line || !tip || !DS.data) return;
    const isMinute = DS.period === 'minute';
    const c = chartData();
    const arr = isMinute ? c.points : c.candles;
    if (!arr || arr.length < 2) return;
    const rect = body.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (arr.length - 1));
    const px = (i / (arr.length - 1)) * rect.width;
    line.style.display = 'block';
    line.style.left = px.toFixed(0) + 'px';
    tip.style.display = 'block';
    tip.style.left = Math.max(4, Math.min(px + 12, rect.width - 160)).toFixed(0) + 'px';
    const q = DS.data.quote;
    const dec = DEC(q.symbol);
    if (isMinute) {
      const p = arr[i];
      const pct = q.prevClose ? ((p.price - q.prevClose) / q.prevClose) * 100 : 0;
      const avgValid = p.avg > 0 && Math.abs(p.avg - q.price) / q.price < 0.3;
      tip.innerHTML = '<b>' + esc(p.t) + '</b> ' + p.price.toFixed(dec) + '<br>' + fmtPct(pct) +
        (avgValid ? '<br>均价 ' + p.avg.toFixed(dec) : '');
    } else {
      const k = arr[i];
      tip.innerHTML = '<b>' + esc(k.date) + '</b><br>开 ' + k.open.toFixed(2) + '　收 ' + k.close.toFixed(2) +
        '<br>高 ' + k.high.toFixed(2) + '　低 ' + k.low.toFixed(2);
    }
  });
  pane.addEventListener('mouseout', (e) => {
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#chartBody')) return;
    const line = $('cxLine'), tip = $('cxTip');
    if (line) line.style.display = 'none';
    if (tip) tip.style.display = 'none';
  });
}
