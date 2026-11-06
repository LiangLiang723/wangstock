/* 命令层：搜索/添加面板、设置、视图菜单。
   高频操作集中到零层级入口，状态（是否已添加、类型）在结果中直接可见。 */
import { $, esc, state, actions, api, call, toast, mountModal, closeModal, showMenu } from './core.js';
import { instrument, firstWatchGroup, groupById, watchIds } from './format.js';

const KIND_LABEL = { etf: 'ETF', index: '指数', fund: '场外', stock: '' };
const looksLikeCode = (v) => /^(?:[a-zA-Z]{2})?\d{4,6}$/.test(String(v || '').trim());

/* ---------- 搜索 / 添加 ---------- */
export function openSearch() {
  state.hits = [];
  state.hitSel = 0;
  const cur = state.group !== 'all' && groupById(state.group)?.kind === 'watch'
    ? state.group : firstWatchGroup();
  state.pickGroups = cur ? [cur] : [];
  const m = mountModal(
    '<div class="palette-input">' +
    '<svg width="15" height="15" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
    '<input id="qInput" placeholder="输入代码、名称或拼音首字母" autocomplete="off" spellcheck="false">' +
    '<kbd>Esc</kbd></div>' +
    '<div class="hits" id="qHits"><div class="hit-empty">输入关键词开始搜索<br><span style="font-size:11px">例如 600519 / 茅台 / 三七 / 通信ETF</span></div></div>' +
    '<div class="group-picker" id="qGroups"></div>' +
    '<div class="modal-foot"><span>↑↓ 选择</span><span>Enter 添加</span><span>Esc 关闭</span>' +
    '<span style="margin-left:auto">代码可直接回车添加</span></div>', true);

  paintGroupChips();
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

/** 命令面板底部的目标分组多选：一个标的可以一次加入多个分组。 */
function paintGroupChips() {
  const box = $('qGroups');
  if (!box) return;
  const groups = (state.data.groups || [])
    .filter((g) => g.kind === 'watch').sort((a, b) => a.sort - b.sort);
  box.innerHTML = '<span class="gp-label">添加到</span>' +
    groups.map((g) => {
      const on = state.pickGroups.includes(g.id);
      return '<button class="chip' + (on ? ' on' : '') + '" data-g="' + esc(g.id) + '">' +
        (on ? '✓ ' : '') + esc(g.name) + '</button>';
    }).join('') + '<span class="gp-hint">可多选，至少保留一个</span>';
  box.querySelectorAll('.chip').forEach((el) => {
    el.onclick = () => {
      const gid = el.dataset.g;
      const i = state.pickGroups.indexOf(gid);
      if (i >= 0) {
        if (state.pickGroups.length > 1) state.pickGroups.splice(i, 1);
      } else {
        state.pickGroups.push(gid);
      }
      paintGroupChips();
    };
  });
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
  const INV = window.__TAURI__.core.invoke;
  const groups = state.pickGroups.length ? state.pickGroups.slice() : [firstWatchGroup()].filter(Boolean);
  if (!groups.length) { toast('请先创建一个自选分组'); return; }
  const watch = watchIds();
  try {
    // 新标的先建档（add_symbol 幂等），再用多选命令写入所有目标分组
    if (!(state.data.instruments || []).some((x) => x.symbol === sym)) {
      state.data = await INV('add_symbol', { symbol: sym, groupId: groups[0] });
    }
    const existing = state.data.members
      .filter((m) => m.symbol === sym && watch.has(m.groupId)).map((m) => m.groupId);
    const finalGroups = Array.from(new Set(existing.concat(groups)));
    const unchanged = finalGroups.length === existing.length &&
      finalGroups.every((g) => existing.includes(g));
    if (!unchanged) {
      state.data = await INV('set_symbol_groups', { symbol: sym, groupIds: finalGroups });
    }
    closeModal();
    actions.render && actions.render();
    actions.refreshNow && actions.refreshNow();
    const label = name || instrument(sym).name;
    toast(unchanged ? label + ' 已在所选分组' : '已添加 ' + label + ' · ' + finalGroups.length + ' 个分组');
  } catch (e) {
    toast('添加失败：' + String(e));
  }
}

/** 已有标的：勾选/取消所属分组，一次性写入。 */
export function openGroupPicker(sym, name) {
  const watch = watchIds();
  const groups = (state.data.groups || [])
    .filter((g) => g.kind === 'watch').sort((a, b) => a.sort - b.sort);
  const cur = state.data.members
    .filter((m) => m.symbol === sym && watch.has(m.groupId)).map((m) => m.groupId);
  const label = name || instrument(sym).name;
  const m = mountModal(
    '<div class="modal-head">管理分组<span class="sub">' + esc(label) + ' · ' + esc(instrument(sym).code) + '</span>' +
    '<button class="iconbtn" id="gClose">✕</button></div>' +
    '<div class="modal-body"><div class="section"><div class="section-title">所属自选分组（可多选）</div>' +
    '<div class="group-list">' + groups.map((g) =>
      '<label class="switch gcheck"><input type="checkbox" data-g="' + esc(g.id) + '"' +
      (cur.includes(g.id) ? ' checked' : '') + '><span>' + esc(g.name) + '</span></label>').join('') +
    '</div><div class="hint">取消全部勾选会把该标的从所有自选分组移除；行业分类不受影响。</div></div></div>' +
    '<div class="modal-actions"><span class="spacer"></span><button class="btn" id="gCancel">取消</button>' +
    '<button class="btn primary" id="gSave">保存</button></div>', true);
  m.querySelector('#gClose').onclick = closeModal;
  m.querySelector('#gCancel').onclick = closeModal;
  m.querySelector('#gSave').onclick = async () => {
    const ids = Array.from(m.querySelectorAll('.gcheck input:checked')).map((x) => x.dataset.g);
    const ok = await call('set_symbol_groups', { symbol: sym, groupIds: ids });
    if (ok) {
      closeModal();
      actions.refreshNow && actions.refreshNow();
      toast(ids.length ? label + ' · 已加入 ' + ids.length + ' 个分组' : label + ' 已从自选移除');
    }
  };
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
