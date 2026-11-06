/* 编排层：启动、轮询、动作注册。视图模块只通过 actions 互相调用。 */
import { $, state, actions, api, EVT, toast } from './core.js';
import { currentSymbols, fmtClock } from './format.js';
import { renderShell, renderHead, renderStatus, renderIndexes, bindShell, INDEXES } from './shell.js';
import { renderSidebar, bindSidebar } from './sidebar.js';
import { renderHead as renderListHead, renderRows, bindList, refreshSparklines, setSort } from './watchlist.js';
import { openDetail, closeDetail, refreshDetail, bindDetail } from './detail.js';
import { openSearch, openSettings, openViewMenu, openGroupPicker } from './palette.js';

let timer = null;
let idxBusy = false;

function render() {
  document.body.dataset.color = state.data?.settings?.colorMode === 'intl' ? 'intl' : 'cn';
  renderShell();
  renderSidebar();
  renderListHead();
  renderRows();
}

function setGroup(gid) {
  if (state.view === 'detail') closeDetail();
  state.group = gid;
  state.rowSig = null;
  render();
  refreshNow();
}

function stepDetail(delta) {
  const list = currentSymbols();
  const i = list.indexOf(state.detailSym);
  const ni = i + delta;
  if (i >= 0 && ni >= 0 && ni < list.length) openDetail(list[ni]);
}

async function refreshIndexes() {
  if (idxBusy) return;
  idxBusy = true;
  try { renderIndexes(await api.quotes(INDEXES)); }
  catch (e) { /* 指数条是辅助信息，失败保留上一次 */ }
  finally { idxBusy = false; }
}

function schedule() {
  clearTimeout(timer);
  const s = state.data?.settings || { refreshSec: 3, idleRefreshSec: 15 };
  const sec = document.hidden ? s.idleRefreshSec : s.refreshSec;
  timer = setTimeout(tick, Math.max(1, sec) * 1000);
}

async function tick() {
  clearTimeout(timer);
  if (!state.data) return;
  refreshIndexes();
  if (state.view === 'detail' && state.detailSym) {
    await refreshDetail(false);
    schedule();
    return;
  }
  const syms = currentSymbols();
  if (!syms.length || state.paused) { schedule(); return; }
  try {
    const qs = await api.quotes(syms);
    if (qs && qs.length) {
      const map = Object.assign({}, state.quotes);
      qs.forEach((q) => { map[q.symbol] = q; });
      state.quotes = map;
      state.source = qs[0].source || '';
      state.error = '';
    }
    state.lastUpdate = new Date();
    if (!state.dragging) {
      renderRows();
      renderStatus();
    }
    // 价格先上屏，缩略图随后补齐，避免冷启动时连接争抢
    refreshSparklines(syms);
  } catch (e) {
    state.error = String(e && e.message ? e.message : e);
    renderStatus();
    renderRows();
  }
  schedule();
}

function refreshNow() {
  clearTimeout(timer);
  tick();
}

/** 脚本异常必须可见，否则用户只会看到一片空白却不知道发生了什么。 */
function showFatal(msg) {
  let bar = $('fatalBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatalBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:26px;z-index:99;padding:8px 12px;' +
      'background:#7a2530;color:#fff;font-size:11.5px;line-height:1.5';
    document.body.appendChild(bar);
  }
  bar.textContent = '界面异常：' + msg;
}
window.addEventListener('error', (e) => showFatal(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => {
  // 运行期的网络失败已在状态栏呈现，只有启动阶段的异常才需要显式横幅
  if (!state.booted) showFatal(String((e.reason && e.reason.stack) || e.reason));
});

async function boot() {
  try {
    state.data = await api.state();
  } catch (e) {
    $('connText').textContent = '初始化失败：' + String(e);
    return;
  }

  Object.assign(actions, {
    render,
    renderHeadInfo: () => { renderHead(); renderStatus(); },
    renderList: renderRows,
    openSearch,
    openSettings,
    openViewMenu,
    openGroupPicker,
    openDetail,
    closeDetail,
    stepDetail,
    setGroup,
    setSort,
    refreshNow,
  });

  bindShell();
  bindSidebar();
  bindList();
  bindDetail();
  try {
    render();
  } catch (e) {
    showFatal(String((e && e.stack) || e));
  }
  state.booted = true;
  // 离屏自检：--detail=代码 可直接打开个股详情，无需任何鼠标操作
  try {
    const args = (await window.__TAURI__.core.invoke('launch_args')) || [];
    const flag = args.find((a) => String(a).startsWith('--detail='));
    const gflag = args.find((a) => String(a).startsWith('--groups='));
    if (flag) openDetail(String(flag).slice('--detail='.length));
    else if (args.includes('--palette')) openSearch();
    if (gflag) openGroupPicker(String(gflag).slice('--groups='.length));
  } catch (e) { /* 命令不可用时按正常启动流程继续 */ }
  tick();
  setInterval(() => {
    if (state.booted) renderStatus();
  }, 1000);

  EVT.listen('toggle-pause', () => {
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? '▶' : '⏸';
    $('btnPause').classList.toggle('on', state.paused);
    renderStatus();
    toast(state.paused ? '已暂停刷新' : '已恢复刷新');
    if (!state.paused) refreshNow();
  }).catch(() => {});
}

boot();
