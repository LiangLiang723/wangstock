/* 命令层：搜索/添加面板、设置、视图菜单。
   高频操作集中到零层级入口，状态（是否已添加、类型）在结果中直接可见。 */
import { $, esc, state, actions, api, call, toast, mountModal, closeModal, showMenu } from './core.js';
import { instrument, firstWatchGroup, fmtClock } from './format.js';

const KIND_LABEL = { etf: 'ETF', index: '指数', fund: '场外', stock: '' };
const looksLikeCode = (v) => /^(?:[a-zA-Z]{2})?\d{4,6}$/.test(String(v || '').trim());

/* ---------- 搜索 / 添加 ---------- */
export function openSearch() {
  state.hits = [];
  state.hitSel = 0;
  const m = mountModal(
    '<div class="palette-input">' +
    '<svg width="15" height="15" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
    '<input id="qInput" placeholder="输入代码、名称或拼音首字母" autocomplete="off" spellcheck="false">' +
    '<kbd>Esc</kbd></div>' +
    '<div class="hits" id="qHits"><div class="hit-empty">输入关键词开始搜索<br><span style="font-size:11px">例如 600519 / 茅台 / 三七 / 通信ETF</span></div></div>' +
    '<div class="modal-foot"><span>↑↓ 选择</span><span>Enter 添加</span><span>Esc 关闭</span>' +
    '<span style="margin-left:auto">代码可直接回车添加</span></div>', true);

  const input = m.querySelector('#qInput');
  input.focus();
  let tmr = null, composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  input.oninput = () => {
    if (composing) return;
    clearTimeout(tmr);
    const v = input.value.trim();
    if (!v) {
      state.hits = [];
      $('qHits').innerHTML = '<div class="hit-empty">输入关键词开始搜索<br><span style="font-size:11px">例如 600519 / 茅台 / 三七 / 通信ETF</span></div>';
      return;
    }
    tmr = setTimeout(() => doSearch(v), 220);
  };
  input.onkeydown = async (e) => {
    // 输入法的回车用于确认候选词，不能当作提交
    if (e.isComposing || composing || e.keyCode === 229) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.hitSel = Math.min(state.hits.length - 1, state.hitSel + 1);
      paintHits(input.value.trim());
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.hitSel = Math.max(0, state.hitSel - 1);
      paintHits(input.value.trim());
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(tmr);
      const v = input.value.trim();
      if (!v) return;
      if (state.hits.length) { await addHit(state.hits[state.hitSel]); return; }
      const hits = await doSearch(v);
      if (hits.length) { await addHit(hits[0]); return; }
      if (!looksLikeCode(v)) { toast('没找到「' + v + '」，换个关键词或试试拼音首字母'); return; }
      await addSymbolDirect(v);
    }
  };
}

async function doSearch(q) {
  const seq = ++state.searchSeq;
  let hits = [];
  try { hits = (await api.search(q)) || []; } catch (e) { hits = []; }
  if (seq !== state.searchSeq) return state.hits || [];
  state.hits = hits;
  state.hitSel = 0;
  paintHits(q);
  return state.hits;
}

function paintHits(q) {
  const box = $('qHits');
  if (!box) return;
  if (!state.hits.length) {
    box.innerHTML = '<div class="hit-empty">没找到「' + esc((q || '').trim()) + '」' +
      '<div style="font-size:11px">换个关键词，或直接输入 6 位 A 股 / 5 位港股代码</div>' +
      '<div style="margin-top:10px"><button class="btn tiny" id="qRetry">重试搜索</button></div></div>';
    const r = $('qRetry');
    if (r) r.onclick = () => doSearch((q || '').trim());
    return;
  }
  box.innerHTML = state.hits.map((h, i) => {
    const kd = KIND_LABEL[h.kind] || '';
    const owned = (state.data.instruments || []).some((x) => x.symbol === h.symbol);
    return '<div class="hit' + (i === state.hitSel ? ' sel' : '') + '" data-i="' + i + '">' +
      (kd ? '<span class="kd">' + kd + '</span>' : '') +
      '<span class="nm">' + esc(h.name) + '</span>' +
      '<span class="cd">' + esc(h.code) + ' · ' + esc(h.market) + '</span>' +
      (owned ? '<span class="own">已添加</span>' : '') + '</div>';
  }).join('');
  box.querySelectorAll('.hit').forEach((el) => {
    el.onmouseenter = () => {
      state.hitSel = +el.dataset.i;
      box.querySelectorAll('.hit').forEach((x, j) => x.classList.toggle('sel', j === state.hitSel));
    };
    el.onclick = () => addHit(state.hits[+el.dataset.i]);
  });
}

async function addHit(h) {
  if (h) await addSymbolDirect(h.symbol, h.name);
}

async function addSymbolDirect(sym, name) {
  if (!looksLikeCode(sym)) { toast('请从搜索结果中选择标的'); return; }
  const target = state.group === 'all' ? firstWatchGroup() : state.group;
  if (!target) { toast('请先创建一个自选分组'); return; }
  const already = state.data.members.some((m) => m.groupId === target && m.symbol === sym);
  if (already) { toast((name || instrument(sym).name) + ' 已在该分组'); return; }
  try {
    state.data = await window.__TAURI__.core.invoke('add_symbol', { symbol: sym, groupId: target });
    closeModal();
    actions.render && actions.render();
    actions.refreshNow && actions.refreshNow();
    toast('已添加 ' + (name || instrument(sym).name));
  } catch (e) {
    toast('添加失败：' + String(e));
  }
}

/* ---------- 视图菜单 ---------- */
export function openViewMenu(e) {
  const s = state.data.settings;
  const rect = e.currentTarget.getBoundingClientRect();
  const sortItems = [
    { key: null, label: '自定义顺序' },
    { key: 'pct', label: '按涨跌幅' },
    { key: 'change', label: '按涨跌额' },
    { key: 'price', label: '按最新价' },
    { key: 'amount', label: '按成交额' },
  ];
  const items = [{ heading: '排序方式' }];
  sortItems.forEach((it) => items.push({
    label: (state.sortKey === it.key ? '● ' : '　') + it.label,
    onClick: () => {
      if (it.key === null) {
        state.sortKey = null; state.sortDir = 1; state.rowSig = null;
        actions.render && actions.render();
      } else actions.setSort && actions.setSort(it.key, true);
    },
  }));
  items.push({ sep: true }, { heading: '显示列' });
  items.push({
    label: (s.showRange ? '✓' : '　') + ' 日内区间',
    onClick: () => saveSettings({ ...s, showRange: !s.showRange }),
  });
  items.push({
    label: (s.showAmount ? '✓' : '　') + ' 成交额',
    onClick: () => saveSettings({ ...s, showAmount: !s.showAmount }),
  });
  showMenu(rect.right - 172, rect.bottom + 4, items);
}

async function saveSettings(next) {
  const ok = await call('update_settings', { settings: next });
  if (ok) { state.rowSig = null; actions.render && actions.render(); toast('显示设置已更新'); }
}

/* ---------- 设置 ---------- */
export function openSettings() {
  const s = state.data.settings;
  const groups = (state.data.groups || []).filter((g) => g.kind === 'watch');
  const m = mountModal(
    '<div class="modal-head">设置<span class="sub">偏好会立即保存到本地</span>' +
    '<button class="iconbtn" id="sClose">✕</button></div>' +
    '<div class="modal-body">' +
    '<div class="section"><div class="section-title">行情刷新</div><div class="row2">' +
    '<div class="field"><label>前台间隔（秒）</label><input class="input" type="number" id="sRefresh" min="1" max="60" value="' + s.refreshSec + '"><div class="hint">窗口可见时的轮询频率</div></div>' +
    '<div class="field"><label>后台间隔（秒）</label><input class="input" type="number" id="sIdle" min="5" max="300" value="' + s.idleRefreshSec + '"><div class="hint">最小化后自动降频</div></div>' +
    '</div></div>' +
    '<div class="section"><div class="section-title">显示</div>' +
    '<div class="field"><label>涨跌配色</label><select class="select" id="sColor">' +
    '<option value="cn"' + (s.colorMode === 'cn' ? ' selected' : '') + '>红涨绿跌（A 股习惯）</option>' +
    '<option value="intl"' + (s.colorMode === 'intl' ? ' selected' : '') + '>绿涨红跌（国际习惯）</option></select></div>' +
    '<div style="display:flex;gap:20px;padding-top:2px">' +
    '<label class="switch"><input type="checkbox" id="sAmt"' + (s.showAmount ? ' checked' : '') + '>显示成交额</label>' +
    '<label class="switch"><input type="checkbox" id="sRange"' + (s.showRange ? ' checked' : '') + '>显示日内区间</label>' +
    '</div></div>' +
    '<div class="section"><div class="section-title">托盘菜单</div><div class="row2">' +
    '<div class="field"><label>显示哪个分组</label><select class="select" id="sFlyGroup"><option value="">全部自选</option>' +
    groups.map((g) => '<option value="' + esc(g.id) + '"' + (s.flyoutGroup === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>最多显示行数</label><input class="input" type="number" id="sFlyLimit" min="3" max="20" value="' + s.flyoutLimit + '"></div>' +
    '</div></div>' +
    '<div class="section"><div class="section-title">关于</div>' +
    '<div style="font-size:11px;color:var(--text-3);line-height:1.8">wangstock · 轻量自选行情桌面端<br>数据来自公开行情接口，仅供参考，不构成投资建议。</div></div>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn danger" id="sQuit">退出程序</button>' +
    '<span class="spacer"></span><button class="btn" id="sCancel">取消</button><button class="btn primary" id="sSave">保存</button></div>', true);

  m.querySelector('#sClose').onclick = closeModal;
  m.querySelector('#sCancel').onclick = closeModal;
  m.querySelector('#sQuit').onclick = () => window.__TAURI__.core.invoke('quit_app');
  m.querySelector('#sSave').onclick = async () => {
    const next = {
      refreshSec: Math.max(1, Math.min(60, +m.querySelector('#sRefresh').value || 3)),
      idleRefreshSec: Math.max(5, Math.min(300, +m.querySelector('#sIdle').value || 15)),
      flyoutGroup: m.querySelector('#sFlyGroup').value || null,
      flyoutLimit: Math.max(3, Math.min(20, +m.querySelector('#sFlyLimit').value || 10)),
      colorMode: m.querySelector('#sColor').value,
      showAmount: m.querySelector('#sAmt').checked,
      showRange: m.querySelector('#sRange').checked,
      closeToTray: true,
    };
    const ok = await call('update_settings', { settings: next });
    if (ok) {
      state.rowSig = null;
      closeModal();
      actions.render && actions.render();
      actions.refreshNow && actions.refreshNow();
      toast('设置已保存');
    }
  };
}
