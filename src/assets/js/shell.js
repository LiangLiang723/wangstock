/* 外壳层：标题栏、面包屑、指数条、状态栏、全局快捷键与窗口控制。 */
import { $, esc, state, actions, WIN, toast, closeModal, hideMenu } from './core.js';
import { currentSymbols, groupById, instrument, fmtClock, fmtPct, pctCls } from './format.js';

export const INDEXES = ['sh000001', 'sz399001', 'sz399006', 'hkHSI'];

export function renderHead() {
  const n = currentSymbols().length;
  const parent = $('crumbParent');
  const title = $('crumbTitle');
  const meta = $('crumbMeta');
  if (state.view === 'detail' && state.detailSym) {
    const ins = instrument(state.detailSym);
    const g = state.group === 'all' ? '全部自选' : (groupById(state.group)?.name || '自选');
    parent.textContent = g + ' ›';
    parent.onclick = () => actions.closeDetail && actions.closeDetail();
    title.textContent = ins.name;
    meta.textContent = ins.code + ' · ' + ins.market + '　·　Esc 返回列表，↑↓ 切换个股';
  } else {
    const g = state.group === 'all' ? null : groupById(state.group);
    parent.textContent = '';
    parent.onclick = null;
    title.textContent = g ? g.name : '全部自选';
    meta.textContent = n + ' 个标的' + (n > 1 ? ' · 拖动行可排序 · 单击查看明细' : '') +
      (state.sortKey ? ' · 当前按列排序' : '');
  }
  $('btnSplit').classList.toggle('on', state.split);
  $('content').classList.toggle('split', state.split);
  $('content').classList.toggle('detail-mode', state.view === 'detail');
}

export function renderIndexes(qs) {
  const box = $('indexbar');
  const map = {};
  (qs || []).forEach((q) => { map[q.symbol] = q; });
  const any = INDEXES.some((s) => map[s]);
  if (!any) {
    if (!state.indexes.length && !box.querySelector('.placeholder')) {
      box.innerHTML = '<div class="placeholder">' + INDEXES.map(() => '<div class="skeleton"></div>').join('') + '</div>';
    }
    return;
  }
  state.indexes = qs;
  box.innerHTML = INDEXES.map((sym) => {
    const q = map[sym];
    if (!q) return '';
    const cls = pctCls(q.pct);
    return '<div class="idx"><span class="n">' + esc(q.name) + '</span>' +
      '<span class="v ' + cls + '">' + q.price.toFixed(2) + '</span>' +
      '<span class="p ' + cls + '">' + fmtPct(q.pct) + '</span></div>';
  }).join('');
}

export function renderStatus() {
  const led = $('led'), text = $('connText'), action = $('connAction');
  led.className = 'led';
  action.innerHTML = '';
  if (state.error) {
    led.classList.add('bad');
    text.textContent = '行情异常：' + state.error;
    action.innerHTML = '<span class="link" id="retryBtn">立即重试</span>';
    const r = $('retryBtn');
    if (r) r.onclick = () => actions.refreshNow && actions.refreshNow();
  } else if (state.paused) {
    led.classList.add('warn');
    text.textContent = '已暂停刷新';
  } else {
    const stale = Object.values(state.quotes).some((q) => q.status === 'stale');
    if (stale) led.classList.add('warn');
    text.textContent = stale ? '显示缓存数据' : '数据正常';
  }
  const sec = state.data ? (document.hidden ? state.data.settings.idleRefreshSec : state.data.settings.refreshSec) : 3;
  $('stSource').textContent = state.source ? '来源 ' + state.source : '';
  $('stUpdate').textContent = state.lastUpdate ? '更新 ' + fmtClock(state.lastUpdate) : '';
  $('stInterval').textContent = state.paused ? '已暂停' : '每 ' + sec + ' 秒';
  $('stCount').textContent = currentSymbols().length + ' 个标的';
  $('tbFeed').innerHTML = state.lastUpdate
    ? '<b>' + fmtClock(state.lastUpdate) + '</b>' + (state.source ? ' · ' + esc(state.source) : '') : '';
}

export function renderShell() {
  renderHead();
  renderStatus();
  document.body.dataset.color = state.data?.settings?.colorMode === 'intl' ? 'intl' : 'cn';
}

export function bindShell() {
  $('btnMin').onclick = () => WIN.minimize();
  $('btnClose').onclick = () => WIN.close();
  $('btnMax').onclick = async () => {
    if (await WIN.isMaximized()) WIN.unmaximize(); else WIN.maximize();
  };
  $('searchTrigger').onclick = () => actions.openSearch && actions.openSearch();
  $('btnAdd').onclick = () => actions.openSearch && actions.openSearch();
  $('btnView').onclick = (e) => actions.openViewMenu && actions.openViewMenu(e);
  $('btnSettings').onclick = () => actions.openSettings && actions.openSettings();
  $('btnPause').onclick = () => {
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? '▶' : '⏸';
    $('btnPause').classList.toggle('on', state.paused);
    renderStatus();
    toast(state.paused ? '已暂停刷新' : '已恢复刷新');
    if (!state.paused) actions.refreshNow && actions.refreshNow();
  };
  $('btnSplit').onclick = () => {
    state.split = !state.split;
    if (state.split && state.view !== 'detail') {
      const list = currentSymbols();
      if (list.length) actions.openDetail && actions.openDetail(list[0]);
    }
    state.rowSig = null;
    actions.render && actions.render();
  };
  $('crumbParent').onclick = () => actions.closeDetail && actions.closeDetail();

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      actions.openSearch && actions.openSearch();
      return;
    }
    if (e.key === 'Escape') {
      if ($('overlay').classList.contains('on')) { closeModal(); return; }
      if ($('ctxMenu').classList.contains('on')) { hideMenu(); return; }
      if (state.view === 'detail') { actions.closeDetail && actions.closeDetail(); return; }
    }
    if (state.view === 'detail' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const list = currentSymbols();
      const i = list.indexOf(state.detailSym);
      const ni = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (i >= 0 && ni >= 0 && ni < list.length) {
        e.preventDefault();
        actions.openDetail && actions.openDetail(list[ni]);
      }
    }
  });
  document.addEventListener('visibilitychange', () => renderStatus());
}
