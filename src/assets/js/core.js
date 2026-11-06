/* 基础层：状态、命令通道、通用 UI 原语。
   视图模块只依赖这一层，彼此不直接引用，靠 actions 反向调用编排层。 */

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const INV = window.__TAURI__.core.invoke;
export const WIN = window.__TAURI__.window.getCurrentWindow();
export const EVT = window.__TAURI__.event;

/** IPC 本身没有超时，后端异常时 await 会永久挂住，轮询就此停摆。 */
export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + '超时')), ms)),
  ]);
}

/** 单一状态源。所有视图读它，命令返回后统一更新 data。 */
export const state = {
  data: null,
  group: 'all',
  view: 'list',
  detailSym: null,
  split: false,
  quotes: {},
  spark: {},
  sparkBusy: false,
  indexes: [],
  sortKey: null,
  sortDir: 1,
  rowSig: null,
  justDragged: false,
  dragging: null,
  paused: false,
  source: '',
  error: '',
  lastUpdate: null,
  searchSeq: 0,
  hits: [],
  hitSel: 0,
  pickGroups: [],
  booted: false,
};

/** 编排层注册的能力，避免视图之间循环依赖。 */
export const actions = {};

export const api = {
  state: () => withTimeout(INV('get_state'), 8000, '读取本地数据'),
  quotes: (symbols) => withTimeout(INV('get_quotes', { symbols }), 10000, '行情请求'),
  detail: (symbol) => withTimeout(INV('get_detail', { symbol }), 10000, '详情请求'),
  minute: (symbol) => withTimeout(INV('get_minute', { symbol }), 10000, '分时请求'),
  kline: (symbol, period, limit) => withTimeout(INV('get_kline', { symbol, period, limit }), 12000, 'K线请求'),
  sparklines: (symbols) => withTimeout(INV('get_sparklines', { symbols }), 20000, '缩略图'),
  search: (query) => withTimeout(INV('search_symbols', { query }), 6000, '搜索'),
};

/** 调用写命令：成功后替换 data 并触发全量渲染。 */
export async function call(cmd, args, doneMsg) {
  try {
    state.data = await INV(cmd, args || {});
    actions.render && actions.render();
    if (doneMsg) toast(doneMsg);
    return true;
  } catch (e) {
    toast('操作失败：' + String(e));
    return false;
  }
}

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(msg, actionLabel, action) {
  const t = $('toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
  t.classList.add('on');
  const btn = t.querySelector('button');
  if (btn) btn.onclick = () => { t.classList.remove('on'); action && action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

/* ---------- 模态框 ---------- */
export function closeModal() {
  $('overlay').classList.remove('on');
  const host = $('modalHost');
  host.classList.remove('on');
  host.innerHTML = '';
}

export function mountModal(html, wide) {
  closeModal();
  $('overlay').classList.add('on');
  const host = $('modalHost');
  host.classList.add('on');
  host.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '">' + html + '</div>';
  const modal = host.firstElementChild;
  $('overlay').onclick = closeModal;
  return modal;
}

export function openPrompt(title, value, onSubmit, hint) {
  const m = mountModal(
    '<div class="modal-head">' + esc(title) + '</div>' +
    '<div class="modal-body"><div class="field"><label>名称</label>' +
    '<input class="input" id="pInput" autocomplete="off" value="' + esc(value || '') + '"></div>' +
    (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>' +
    '<div class="modal-actions"><span class="spacer"></span><button class="btn" id="pCancel">取消</button><button class="btn primary" id="pOk">确定</button></div>'
  );
  const input = m.querySelector('#pInput');
  input.focus();
  input.select();
  const ok = () => {
    const v = input.value.trim();
    if (!v) return;
    closeModal();
    onSubmit(v);
  };
  m.querySelector('#pOk').onclick = ok;
  m.querySelector('#pCancel').onclick = closeModal;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') ok();
    if (e.key === 'Escape') closeModal();
  };
}

export function confirmBox(title, text, onOk, okLabel) {
  const m = mountModal(
    '<div class="modal-head">' + esc(title) + '</div>' +
    '<div class="modal-body"><div style="font-size:12.5px;color:var(--text-2);line-height:1.7">' + esc(text) + '</div></div>' +
    '<div class="modal-actions"><span class="spacer"></span><button class="btn" id="cNo">取消</button><button class="btn danger" id="cYes">' + esc(okLabel || '确定') + '</button></div>'
  );
  m.querySelector('#cNo').onclick = closeModal;
  m.querySelector('#cYes').onclick = () => { closeModal(); onOk(); };
}

/* ---------- 右键菜单 ---------- */
let menuGuard = false;
export function hideMenu() { $('ctxMenu').classList.remove('on'); }

/** 菜单也可能由普通按钮点开，忽略打开它的那一次冒泡，避免立刻自我关闭。 */
document.addEventListener('click', (e) => {
  if (menuGuard) return;
  if (!e.target.closest('#ctxMenu')) hideMenu();
});

export function showMenu(x, y, items) {
  const menu = $('ctxMenu');
  items.forEach((it, i) => { it._i = i; });
  menu.innerHTML = items.map((it, i) => {
    if (it.sep) return '<div class="sep"></div>';
    if (it.heading) return '<div class="heading">' + esc(it.heading) + '</div>';
    return '<div class="item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
      '<span>' + esc(it.label) + '</span>' + (it.shortcut ? '<span class="shortcut">' + esc(it.shortcut) + '</span>' : '') + '</div>';
  }).join('');
  menu.querySelectorAll('.item').forEach((el) => {
    el.onclick = () => {
      hideMenu();
      const it = items[+el.dataset.i];
      it.onClick && it.onClick();
    };
  });
  menu.classList.add('on');
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
  menuGuard = true;
  setTimeout(() => { menuGuard = false; }, 0);
}
