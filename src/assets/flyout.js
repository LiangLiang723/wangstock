(() => {
  'use strict';

  const INV = window.__TAURI__.core.invoke;
  const EVT = window.__TAURI__.event;
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROW = 28;
  const PAD = 10;
  const SEP = 11;
  const UPD = 20;
  const QUIT = 28;

  let data = null;
  let timer = null;
  let lastHeight = 0;

  const pctCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const fmtPct = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');

  function watchSymbols() {
    if (!data) return [];
    const limit = Math.max(3, Math.min(20, data.settings.flyoutLimit || 10));
    const gid = data.settings.flyoutGroup;
    if (!gid) {
      const seen = new Set();
      const out = [];
      const groups = data.groups.filter((g) => g.kind === 'watch').sort((a, b) => a.sort - b.sort);
      for (const g of groups) {
        data.members
          .filter((m) => m.groupId === g.id)
          .sort((a, b) => a.sort - b.sort)
          .forEach((m) => {
            if (!seen.has(m.symbol)) {
              seen.add(m.symbol);
              out.push(m.symbol);
            }
          });
      }
      return out.slice(0, limit);
    }
    return data.members
      .filter((m) => m.groupId === gid)
      .sort((a, b) => a.sort - b.sort)
      .map((m) => m.symbol)
      .slice(0, limit);
  }

  function render(quotes) {
    document.body.dataset.color = data.settings.colorMode === 'intl' ? 'intl' : 'cn';

    const syms = watchSymbols();
    const list = $('list');
    const map = {};
    (quotes || []).forEach((q) => (map[q.symbol] = q));

    if (!syms.length) {
      list.innerHTML = '<div class="empty">还没有自选标的<br>双击托盘图标打开主界面添加</div>';
    } else {
      list.innerHTML = syms
        .map((sym) => {
          const q = map[sym];
          const ins = data.instruments.find((i) => i.symbol === sym) || { name: sym, code: sym.slice(2) };
          const cls = q ? pctCls(q.pct) : 'flat';
          return (
            '<div class="row">' +
            '<span class="nm">' + esc(ins.name) + '</span>' +
            '<span class="pc"><span class="' + cls + '">' + (q ? fmtPct(q.pct) : '—') + '</span></span>' +
            '</div>'
          );
        })
        .join('');
    }

    const rows = Math.max(1, syms.length);
    const h = PAD + rows * ROW + SEP + UPD + QUIT + 4;
    if (Math.abs(h - lastHeight) > 1) {
      lastHeight = h;
      INV('resize_flyout', { height: h }).catch(() => {});
    }

    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    $('upd').textContent = '更新于 ' + p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      if (!data) data = await INV('get_state');
      const syms = watchSymbols();
      let quotes = [];
      if (syms.length) quotes = await INV('get_quotes', { symbols: syms });
      render(quotes);
    } catch (e) {
      render([]);
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    const sec = data && data.settings.refreshSec ? data.settings.refreshSec : 3;
    timer = setTimeout(refresh, Math.max(1, sec) * 1000);
  }

  $('quit').onclick = () => INV('quit_app');

  EVT.listen('flyout-shown', () => {
    data = null;
    refresh();
  }).catch(() => {});

  refresh();
})();
