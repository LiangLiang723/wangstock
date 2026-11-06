/* 列表层：行情表、排序、行内操作、自定义拖拽、缩略图。
   列表是「扫描视图」：数字优先，操作常驻但低对比，hover 才强化。 */
import { $, esc, state, actions, api, call, toast, showMenu, confirmBox, withTimeout } from './core.js';
import {
  currentSymbols, instrument, groupById, DEC, pctCls, fmtPrice, fmtChg, fmtPct, fmtAmt,
  STATUS_TEXT, sparkSvg,
} from './format.js';

const COLS = [
  { k: 'name', t: '名称 / 代码' },
  { k: 'spark', t: '走势' },
  { k: 'price', t: '最新价' },
  { k: 'change', t: '涨跌额' },
  { k: 'pct', t: '涨跌幅' },
  { k: 'range', t: '日内区间' },
  { k: 'amount', t: '成交额' },
  { k: 'status', t: '状态' },
  { k: 'ops', t: '操作' },
];

/** 并排模式下列表只承担「选标的」的职责，收敛为三列。 */
const compact = () => state.split && state.view === 'detail';

function visibleCols() {
  if (compact()) return [COLS[0], COLS[2], COLS[4]];
  const s = state.data?.settings || { showRange: true, showAmount: true };
  return COLS.filter((c) => (c.k === 'range' ? s.showRange : c.k === 'amount' ? s.showAmount : true));
}

export function gridCols() {
  if (compact()) return 'minmax(80px, 1fr) 76px 76px';
  const s = state.data?.settings || { showRange: true, showAmount: true };
  const parts = ['minmax(96px, 1fr)', '52px', '76px', '72px', '76px'];
  if (s.showRange) parts.push('76px');
  if (s.showAmount) parts.push('72px');
  parts.push('52px', '66px');
  return parts.join(' ');
}

export function renderHead() {
  const cols = visibleCols();
  $('thead').innerHTML = cols.map((c) => {
    const sortable = ['price', 'change', 'pct', 'amount'].includes(c.k);
    const on = state.sortKey === c.k;
    return '<div' + (sortable ? ' data-sort="' + c.k + '"' : '') + (on ? ' class="sorted"' : '') + '>' +
      c.t + (on ? '<span class="arrow">' + (state.sortDir > 0 ? '▲' : '▼') + '</span>' : '') + '</div>';
  }).join('');
  document.documentElement.style.setProperty('--grid-cols', gridCols());
}

function sortedSymbols(syms) {
  if (!state.sortKey) return syms;
  const arr = syms.slice();
  arr.sort((a, b) => {
    const qa = state.quotes[a], qb = state.quotes[b];
    const va = qa ? qa[state.sortKey] : null, vb = qb ? qb[state.sortKey] : null;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.sortDir;
  });
  return arr;
}

function rowHtml(sym) {
  const q = state.quotes[sym];
  const ins = instrument(sym);
  const d = DEC(sym);
  const cls = q ? pctCls(q.pct) : 'flat';
  if (compact()) {
    return '<div class="row" data-symbol="' + esc(sym) + '" title="点击查看明细">' +
      '<div class="c-name"><span class="nm">' + esc(ins.name) + '</span>' +
      '<span class="cd">' + esc(ins.code) + '</span></div>' +
      '<div class="num js-price ' + cls + '">' + (q ? fmtPrice(q.price, d) : '—') + '</div>' +
      '<div class="num"><span class="pct js-pct ' + cls + '">' + (q ? fmtPct(q.pct) : '—') + '</span></div>' +
      '</div>';
  }
  const s = state.data.settings;
  const pos = q && q.high > q.low ? Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low)) * 100)) : 50;
  const range = s.showRange
    ? '<div class="range" title="今低 ' + (q ? q.low.toFixed(d) : '—') + ' · 今高 ' + (q ? q.high.toFixed(d) : '—') + '"><em class="js-dot ' + cls + '" style="left:' + pos.toFixed(1) + '%"></em></div>'
    : '';
  const amt = s.showAmount ? '<div class="num js-amt">' + (q ? fmtAmt(q.amount) : '—') + '</div>' : '';
  const st = q ? q.status : 'closed';
  const sp = state.spark[sym];
  return '<div class="row" data-symbol="' + esc(sym) + '" title="拖动调整顺序 · 点击查看明细">' +
    '<div class="c-name"><span class="nm">' + esc(ins.name) + '</span>' +
    '<span class="cd">' + esc(ins.code) + '</span><span class="mk">' + esc(ins.market) + '</span></div>' +
    '<div class="spark js-spark">' + (sp ? sparkSvg(sp.data, q ? q.prevClose : 0) : '') + '</div>' +
    '<div class="num js-price ' + cls + '">' + (q ? fmtPrice(q.price, d) : '—') + '</div>' +
    '<div class="num js-chg ' + cls + '">' + (q ? fmtChg(q.change, d) : '—') + '</div>' +
    '<div class="num"><span class="pct js-pct ' + cls + '">' + (q ? fmtPct(q.pct) : '—') + '</span></div>' +
    range + amt +
    '<div class="num"><span class="tag js-tag ' + st + '">' + (STATUS_TEXT[st] || st) + '</span></div>' +
    '<div class="ops">' +
    '<button class="iconbtn" data-op="up" title="上移">↑</button>' +
    '<button class="iconbtn" data-op="down" title="下移">↓</button>' +
    '<button class="iconbtn" data-op="more" title="更多操作">⋯</button>' +
    '</div></div>';
}

function skeletonHtml() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += '<div class="skeleton-row">' +
      '<div class="skeleton" style="width:70%"></div><div class="skeleton"></div>' +
      '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>' +
      '<div class="skeleton"></div><div class="skeleton"></div></div>';
  }
  return out;
}

export function renderRows() {
  if (!state.data) return;
  const body = $('tbody');
  const syms = currentSymbols();
  // 首批行情未到达时只显示骨架，避免「空数据行 + 骨架」混排
  if (!state.lastUpdate && !Object.keys(state.quotes).length) {
    body.innerHTML = skeletonHtml();
    state.rowSig = null;
    return;
  }
  if (!syms.length) {
    body.innerHTML = '<div class="empty-state"><b>这个分组还没有标的</b>' +
      '<span>按 Ctrl K 搜索并添加股票或 ETF</span>' +
      '<button class="btn primary" id="emptyAdd" style="margin-top:6px">＋ 添加标的</button></div>';
    const b = $('emptyAdd');
    if (b) b.onclick = () => actions.openSearch && actions.openSearch();
    state.rowSig = null;
    return;
  }
  if (state.error && !Object.keys(state.quotes).length) {
    body.innerHTML = '<div class="error-state"><span class="msg">' + esc(state.error) + '</span>' +
      '<button class="btn" id="listRetry">重新加载</button></div>';
    const b = $('listRetry');
    if (b) b.onclick = () => actions.refreshNow && actions.refreshNow();
    state.rowSig = null;
    return;
  }
  const list = sortedSymbols(syms);
  // 首帧骨架在首批行情到达后移除，避免与真实行混排
  if (Object.keys(state.quotes).length) body.querySelectorAll('.skeleton-row').forEach((n) => n.remove());
  const sig = list.join(',') + '|' + state.data.settings.showAmount + state.data.settings.showRange + '|' + (state.sortKey || '') + state.sortDir;
  if (state.rowSig === sig && body.children.length === list.length && body.querySelector('.row')) {
    updateRows(list);
    return;
  }
  state.rowSig = sig;
  body.innerHTML = list.map(rowHtml).join('');
}

export function updateRows(list) {
  const body = $('tbody');
  const rows = body.querySelectorAll('.row');
  list.forEach((sym, i) => {
    const row = rows[i];
    const q = state.quotes[sym];
    if (!row || !q) return;
    const d = DEC(sym);
    const cls = pctCls(q.pct);
    const set = (sel, text, className) => {
      const el = row.querySelector(sel);
      if (!el) return;
      el.textContent = text;
      if (className != null) el.className = className;
    };
    set('.js-price', fmtPrice(q.price, d), 'num js-price ' + cls);
    set('.js-chg', fmtChg(q.change, d), 'num js-chg ' + cls);
    set('.js-pct', fmtPct(q.pct), 'pct js-pct ' + cls);
    set('.js-amt', fmtAmt(q.amount));
    set('.js-tag', STATUS_TEXT[q.status] || q.status, 'tag js-tag ' + q.status);
    const dot = row.querySelector('.js-dot');
    if (dot) {
      dot.style.left = (q.high > q.low ? Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low)) * 100)) : 50).toFixed(1) + '%';
      dot.className = 'js-dot ' + cls;
    }
  });
}

export function updateSparks(list) {
  const rows = $('tbody').querySelectorAll('.row');
  list.forEach((sym, i) => {
    const cell = rows[i]?.querySelector('.js-spark');
    const sp = state.spark[sym];
    const q = state.quotes[sym];
    if (cell && sp && q) cell.innerHTML = sparkSvg(sp.data, q.prevClose);
  });
}

export async function refreshSparklines(syms) {
  if (state.sparkBusy) return;
  const now = Date.now();
  const need = syms.filter((s) => !state.spark[s] || now - state.spark[s].at > 90000);
  if (!need.length) return;
  state.sparkBusy = true;
  try {
    const map = await api.sparklines(need.slice(0, 12));
    const at = Date.now();
    Object.keys(map || {}).forEach((k) => { state.spark[k] = { at, data: map[k] }; });
    updateSparks(currentSymbols());
  } catch (e) { /* 缩略图是辅助信息，失败不影响主流程 */ }
  finally { state.sparkBusy = false; }
}

/* ---------- 排序操作 ---------- */
export async function moveRow(sym, delta) {
  if (state.sortKey) { state.sortKey = null; state.sortDir = 1; renderHead(); }
  const list = currentSymbols();
  const i = list.indexOf(sym), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = list.slice();
  next.splice(i, 1);
  next.splice(j, 0, sym);
  state.rowSig = null;
  const ok = await call('reorder_symbols', { groupId: state.group, symbols: next });
  if (ok) toast(delta < 0 ? '已上移' : '已下移');
}

export function setSort(k, force) {
  if (state.sortKey === k) {
    if (force) { /* 视图菜单重复选择时保持当前方向 */ }
    else {
      state.sortDir = -state.sortDir;
      if (state.sortDir === 1) state.sortKey = null;
    }
  } else {
    state.sortKey = k;
    state.sortDir = -1;
  }
  state.rowSig = null;
  renderHead();
  renderRows();
  actions.renderHeadInfo && actions.renderHeadInfo();
}

/* ---------- 行操作与右键菜单 ---------- */
function rowMenu(sym, x, y) {
  const ins = instrument(sym);
  const groups = (state.data.groups || []).filter((g) => g.kind === 'watch' && g.id !== state.group);
  const items = [
    { heading: ins.name + ' · ' + ins.code },
    { label: '查看详情', onClick: () => actions.openDetail && actions.openDetail(sym) },
    { label: '上移', onClick: () => moveRow(sym, -1) },
    { label: '下移', onClick: () => moveRow(sym, 1) },
    { sep: true },
  ];
  groups.forEach((g) => items.push({
    label: '移到 ' + g.name,
    onClick: () => state.group === 'all'
      ? call('add_symbol', { symbol: sym, groupId: g.id }, '已加入分组')
      : call('move_symbol', { symbol: sym, fromGroup: state.group, toGroup: g.id }, '已移动'),
  }));
  items.push({ sep: true });
  if (state.group !== 'all') items.push({
    label: '从本组移除', danger: true,
    onClick: () => call('remove_symbol', { symbol: sym, groupId: state.group }, '已移除'),
  });
  items.push({
    label: '删除自选', danger: true,
    onClick: () => confirmBox('删除自选', '将从所有分组中移除「' + ins.name + '」。', async () => {
      const ids = state.data.members.filter((m) => m.symbol === sym).map((m) => m.groupId);
      for (const gid of ids) state.data = await window.__TAURI__.core.invoke('remove_symbol', { symbol: sym, groupId: gid });
      actions.render && actions.render();
      toast('已删除 ' + ins.name);
    }, '删除'),
  });
  showMenu(x, y, items);
}

/* ---------- 自定义拖拽（不依赖 WebView2 的原生 OLE 拖放） ---------- */
let drag = null;
function clearMarks() {
  document.querySelectorAll('.row.drop-above,.row.drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
  document.querySelectorAll('.nav-item.drag-over').forEach((r) => r.classList.remove('drag-over'));
}
function endDrag() {
  if (!drag) return;
  drag.row.classList.remove('dragging');
  document.body.style.cursor = '';
  clearMarks();
  drag = null;
  state.dragging = null;
}

function bindDrag() {
  const tbody = $('tbody');
  tbody.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.ops')) return;
    const row = e.target.closest('.row');
    if (!row) return;
    if (state.sortKey) {
      state.sortKey = null; state.sortDir = 1;
      renderHead(); renderRows();
      toast('已切回自定义顺序，请再拖一次');
      return;
    }
    drag = { sym: row.dataset.symbol, x: e.clientX, y: e.clientY, active: false, row, target: null, before: false, gid: null };
  });

  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x) < 4 && Math.abs(e.clientY - drag.y) < 6) return;
      drag.active = true;
      state.dragging = drag.sym;
      drag.row.classList.add('dragging');
      document.body.style.cursor = 'grabbing';
    }
    e.preventDefault();
    clearMarks();
    drag.target = null; drag.gid = null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const grp = el && el.closest('.nav-item[data-gid]');
    if (grp && grp.dataset.gid !== 'all') {
      grp.classList.add('drag-over');
      drag.gid = grp.dataset.gid;
      return;
    }
    const row = el && el.closest('.row');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    drag.before = e.clientY - rect.top < rect.height / 2;
    drag.target = row.dataset.symbol;
    row.classList.add(drag.before ? 'drop-above' : 'drop-below');
    const box = tbody.getBoundingClientRect();
    if (e.clientY < box.top + 26) tbody.scrollTop -= 14;
    else if (e.clientY > box.bottom - 26) tbody.scrollTop += 14;
  });

  document.addEventListener('mouseup', async () => {
    if (!drag) return;
    const d = drag;
    if (!d.active) { drag = null; return; }
    state.justDragged = true;
    setTimeout(() => { state.justDragged = false; }, 180);
    endDrag();
    if (d.gid) {
      if (state.group === 'all') await call('add_symbol', { symbol: d.sym, groupId: d.gid }, '已加入分组');
      else await call('move_symbol', { symbol: d.sym, fromGroup: state.group, toGroup: d.gid }, '已移动');
      actions.refreshNow && actions.refreshNow();
      return;
    }
    if (!d.target || d.target === d.sym) return;
    const list = currentSymbols().filter((x) => x !== d.sym);
    const at = list.indexOf(d.target);
    if (at < 0) return;
    list.splice(d.before ? at : at + 1, 0, d.sym);
    state.rowSig = null;
    const ok = await call('reorder_symbols', { groupId: state.group, symbols: list });
    if (ok) toast('顺序已更新');
    actions.refreshNow && actions.refreshNow();
  });
  window.addEventListener('blur', endDrag);
}

export function bindList() {
  const tbody = $('tbody');
  tbody.addEventListener('click', (e) => {
    if (state.justDragged) return;
    const op = e.target.closest('[data-op]');
    const row = e.target.closest('.row');
    if (!row) return;
    const sym = row.dataset.symbol;
    if (op) {
      if (op.dataset.op === 'more') {
        const r = op.getBoundingClientRect();
        rowMenu(sym, r.right - 160, r.bottom + 2);
      } else if (op.dataset.op === 'up') moveRow(sym, -1);
      else if (op.dataset.op === 'down') moveRow(sym, 1);
      return;
    }
    actions.openDetail && actions.openDetail(sym);
  });
  tbody.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    rowMenu(row.dataset.symbol, e.clientX, e.clientY);
  });
  $('thead').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-sort]');
    if (cell) setSort(cell.dataset.sort);
  });
  bindDrag();
}
