(() => {
  'use strict';

  const INV = window.__TAURI__.core.invoke;
  const WIN = window.__TAURI__.window.getCurrentWindow();
  const EVT = window.__TAURI__.event;

  const S = {
    data: null,
    quotes: {},
    group: 'all',
    view: 'list',
    detailSym: null,
    sortKey: null,
    sortDir: 1,
    rowSig: null,
    justDragged: false,
    spark: {},
    sparkBusy: false,
    paused: false,
    lastUpdate: null,
    source: '',
    error: '',
    timer: null,
    dragging: null,
    hits: [],
    hitSel: 0,
    searchSeq: 0,
  };

  const $ = (id) => document.getElementById(id);

  // IPC 本身不设超时，后端异常时 await 会一直挂住，轮询就此停摆。
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + '超时')), ms)),
    ]);
  }
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pctCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const DEC = (sym) => {
    const ins = (S.data.instruments || []).find((i) => i.symbol === sym);
    if (ins && ins.kind === 'etf') return 3;
    return sym.startsWith('hk') ? 3 : 2;
  };
  const num = (v, d) => (v == null || v === 0 ? '—' : v.toFixed(d));

  function fmtPrice(v, d) {
    if (v == null || v === 0) return '—';
    return v.toFixed(d);
  }
  function fmtChg(v, d) {
    if (v == null) return '—';
    if (v === 0) return '0.' + '0'.repeat(d);
    return (v > 0 ? '+' : '') + v.toFixed(d);
  }
  function fmtPct(v) {
    if (v == null) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtAmt(v) {
    if (!v) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return v.toFixed(0);
  }
  function sparkSvg(data, prev) {
    const W = 60, H = 18, P = 1;
    if (!data || data.length < 2) return '';
    let min = Math.min.apply(null, data);
    let max = Math.max.apply(null, data);
    if (prev) {
      min = Math.min(min, prev);
      max = Math.max(max, prev);
    }
    if (max - min < 1e-9) max = min + 0.01;
    const n = data.length;
    const x = (i) => P + (i / (n - 1)) * (W - P * 2);
    const y = (v) => H - P - ((v - min) / (max - min)) * (H - P * 2);
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(data[i]).toFixed(1);
    const last = data[n - 1];
    const col = prev ? (last >= prev ? cssVar('--pos') : cssVar('--neg')) : cssVar('--text3');
    let base = '';
    if (prev) {
      const by = y(prev).toFixed(1);
      base = '<line x1="' + P + '" y1="' + by + '" x2="' + (W - P) + '" y2="' + by + '" stroke="#2e2e38" stroke-width="0.8"/>';
    }
    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + base +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.2"/></svg>'
    );
  }

  function updateSparks(list) {
    const body = $('tbody');
    for (let i = 0; i < list.length; i++) {
      const sym = list[i];
      const row = body.children[i];
      const cell = row && row.querySelector('.js-spark');
      if (!cell) continue;
      const sp = S.spark[sym];
      const q = S.quotes[sym];
      if (sp && sp.data && q) cell.innerHTML = sparkSvg(sp.data, q.prevClose);
    }
  }

  async function refreshSparklines(syms) {
    if (S.sparkBusy) return;
    const now = Date.now();
    const need = syms.filter((x) => !S.spark[x] || now - S.spark[x].at > 90000);
    if (!need.length) return;
    S.sparkBusy = true;
    try {
      const map = await withTimeout(
        INV('get_sparklines', { symbols: need.slice(0, 12) }),
        20000,
        '缩略图'
      );
      const at = Date.now();
      Object.keys(map || {}).forEach((k) => {
        S.spark[k] = { at: at, data: map[k] };
      });
      updateSparks(currentSymbols());
    } catch (e) {
    } finally {
      S.sparkBusy = false;
    }
  }

  function fmtClock(d) {
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  const STATUS_TEXT = { live: '实时', delayed: '延迟', closed: '收盘', stale: '缓存' };

  // ---------- 数据选择 ----------

  function watchIds() {
    const set = new Set();
    (S.data.groups || []).forEach((g) => {
      if (g.kind === 'watch') set.add(g.id);
    });
    return set;
  }

  function currentSymbols() {
    if (!S.data) return [];
    if (S.group === 'all') {
      // 全局顺序由 order 维护，用户可以在「全部自选」里直接拖拽排序。
      const watch = new Set(S.data.groups.filter((g) => g.kind === 'watch').map((g) => g.id));
      const valid = new Set(S.data.members.filter((m) => watch.has(m.groupId)).map((m) => m.symbol));
      const seen = new Set();
      const out = [];
      (S.data.order || []).forEach((sym) => {
        if (valid.has(sym) && !seen.has(sym)) {
          seen.add(sym);
          out.push(sym);
        }
      });
      // 兜底：order 尚未包含的新标的按分组顺序补到末尾
      const groups = S.data.groups.filter((g) => g.kind === 'watch').sort((a, b) => a.sort - b.sort);
      for (const g of groups) {
        S.data.members
          .filter((m) => m.groupId === g.id)
          .sort((a, b) => a.sort - b.sort)
          .forEach((m) => {
            if (!seen.has(m.symbol)) {
              seen.add(m.symbol);
              out.push(m.symbol);
            }
          });
      }
      return out;
    }
    return S.data.members
      .filter((m) => m.groupId === S.group)
      .sort((a, b) => a.sort - b.sort)
      .map((m) => m.symbol);
  }

  function countOf(gid) {
    return S.data.members.filter((m) => m.groupId === gid).length;
  }

  function groupById(id) {
    return (S.data.groups || []).find((g) => g.id === id);
  }

  // ---------- 渲染 ----------

  function render() {
    if (!S.data) return;
    document.body.dataset.color = S.data.settings.colorMode === 'intl' ? 'intl' : 'cn';
    renderSidebar();
    renderHead();
    renderRows();
    renderStatus();
    renderTitle();
  }

  const CARET = '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1.5 2.5L4 5.5L6.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  function treeHtml(all, parentId, depth, kind) {
    return all
      .filter((g) => g.parentId === parentId && g.kind === kind)
      .sort((a, b) => a.sort - b.sort)
      .map((g) => {
        const kids = all.filter((x) => x.parentId === g.id);
        const active = S.group === g.id ? ' active' : '';
        const collapsed = g.collapsed ? ' collapsed' : '';
        const caret = kids.length ? '<span class="caret">' + CARET + '</span>' : '<span class="caret"></span>';
        const dot = g.color ? '<span class="dot" style="background:' + esc(g.color) + '"></span>' : '';
        const pad = 8 + depth * 13;
        const row =
          '<div class="grp' + active + collapsed + '" data-gid="' + esc(g.id) + '" style="padding-left:' + pad + 'px">' +
          caret + dot + '<span class="gname">' + esc(g.name) + '</span>' +
          '<span class="count">' + countOf(g.id) + '</span></div>';
        return row + (g.collapsed ? '' : treeHtml(all, g.id, depth + 1, kind));
      })
      .join('');
  }

  function renderSidebar() {
    const all = S.data.groups || [];
    const w = watchIds();
    const allCount = new Set(S.data.members.filter((m) => w.has(m.groupId)).map((m) => m.symbol)).size;
    const activeAll = S.group === 'all' ? ' active' : '';

    let html =
      '<div class="grp' + activeAll + '" data-gid="all" style="padding-left:8px"><span class="caret"></span>' +
      '<span class="gname">全部自选</span><span class="count">' + allCount + '</span></div>';

    html += '<div class="side-head"><span>自选分组</span><button class="add" data-new="watch" title="新建分组">＋</button></div>';
    html += treeHtml(all, null, 0, 'watch');
    if (!all.filter((g) => g.kind === 'watch').length) {
      html += '<div style="padding:4px 10px 8px;font-size:11px;color:var(--text3)">还没有分组，点右上角 ＋ 新建</div>';
    }

    html += '<div class="side-head"><span>行业分类</span><button class="add" data-new="industry" title="新建行业">＋</button></div>';
    html += treeHtml(all, null, 0, 'industry');
    if (!all.filter((g) => g.kind === 'industry').length) {
      html += '<div style="padding:4px 10px 8px;font-size:11px;color:var(--text3)">把股票拖到行业上即可归类</div>';
    }

    $('sidebar').innerHTML = html;
  }

  const COLS = [
    { k: 'name', t: '名称 / 代码', left: true, sort: false },
    { k: 'spark', t: '走势', sort: false },
    { k: 'price', t: '最新价' },
    { k: 'change', t: '涨跌额' },
    { k: 'pct', t: '涨跌幅' },
    { k: 'range', t: '日内区间', sort: false },
    { k: 'amount', t: '成交额' },
    { k: 'status', t: '状态', sort: false },
  ];

  function renderHead() {
    const showAmt = S.data.settings.showAmount;
    const showRange = S.data.settings.showRange;
    $('thead').innerHTML = COLS.filter((c) => (c.k === 'amount' ? showAmt : c.k === 'range' ? showRange : true))
      .map((c) => {
        const on = S.sortKey === c.k;
        const arrow = on ? '<span class="arrow">' + (S.sortDir > 0 ? '▲' : '▼') + '</span>' : '';
        return '<div class="' + (on ? 'sorted' : '') + '" data-sort="' + (c.sort === false ? '' : c.k) + '">' + c.t + arrow + '</div>';
      })
      .join('');
    const cols = gridCols();
    document.documentElement.style.setProperty('--grid-cols', cols);
  }

  function gridCols() {
    const s = S.data.settings;
    const parts = ['minmax(118px, 1fr)', '64px', '88px', '84px', '92px'];
    if (s.showRange) parts.push('92px');
    if (s.showAmount) parts.push('84px');
    parts.push('58px');
    return parts.join(' ');
  }

  function sortedSymbols(syms) {
    if (!S.sortKey) return syms;
    const arr = syms.slice();
    arr.sort((a, b) => {
      const qa = S.quotes[a];
      const qb = S.quotes[b];
      const va = qa ? qa[S.sortKey] : null;
      const vb = qb ? qb[S.sortKey] : null;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * S.sortDir;
      return (va - vb) * S.sortDir;
    });
    return arr;
  }

  function renderRows() {
    if (!S.data) return;
    const body = $('tbody');
    const s = S.data.settings;
    const syms = currentSymbols();
    if (!syms.length) {
      body.innerHTML =
        '<div class="empty">' +
        '<svg width="34" height="34" viewBox="0 0 24 24"><polyline points="3,17 8,11 12,13.5 17,7 21,9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="21" x2="21" y2="21" stroke="currentColor" stroke-width="1.2"/></svg>' +
        '<div><b>这个分组还没有标的</b></div>' +
        '<div>按 Ctrl K 搜索并添加股票或 ETF</div></div>';
      renderTitle();
      return;
    }

    const list = sortedSymbols(syms);
    const sig = list.join(',') + '|' + s.showAmount + s.showRange + '|' + (S.sortKey || '') + S.sortDir;
    if (S.rowSig === sig && body.children.length === list.length) {
      updateRows(list);
      renderTitle();
      return;
    }
    S.rowSig = sig;
    body.innerHTML = list
      .map((sym) => {
        const q = S.quotes[sym];
        const ins = S.data.instruments.find((i) => i.symbol === sym) || { name: sym, code: sym.slice(2), market: sym.slice(0, 2).toUpperCase() };
        const d = DEC(sym);
        const cls = q ? pctCls(q.pct) : 'flat';
        const price = q ? fmtPrice(q.price, d) : '—';
        const chg = q ? fmtChg(q.change, d) : '—';
        const pct = q ? fmtPct(q.pct) : '—';
        const pos = q && q.high > q.low ? Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low)) * 100)) : 50;
        const range = s.showRange
          ? '<div class="range" title="' + (q ? '今低 ' + q.low.toFixed(d) + ' · 今高 ' + q.high.toFixed(d) : '') + '"><em class="js-dot ' + cls + '" style="left:' + pos.toFixed(1) + '%"></em></div>'
          : '';
        const amt = s.showAmount ? '<div class="num js-amt">' + (q ? fmtAmt(q.amount) : '—') + '</div>' : '';
        const st = q ? q.status : 'closed';
        return (
          '<div class="row" draggable="true" data-symbol="' + esc(sym) + '">' +
          '<div class="c-name"><span class="nm">' + esc(ins.name) + '</span>' +
          '<span class="cd">' + esc(ins.code) + '</span>' +
          '<span class="mk">' + esc(ins.market) + '</span></div>' +
          '<div class="spark js-spark">' + (S.spark[sym] ? sparkSvg(S.spark[sym].data, q ? q.prevClose : 0) : '') + '</div>' +
          '<div class="num js-price ' + cls + '">' + price + '</div>' +
          '<div class="num js-chg ' + cls + '">' + chg + '</div>' +
          '<div class="num"><span class="pct js-pct ' + cls + '">' + pct + '</span></div>' +
          range + amt +
          '<div class="num"><span class="tag js-tag ' + st + '">' + (STATUS_TEXT[st] || st) + '</span></div>' +
          '</div>'
        );
      })
      .join('');
    renderTitle();
  }

  function updateRows(list) {
    const body = $('tbody');
    for (let i = 0; i < list.length; i++) {
      const sym = list[i];
      const q = S.quotes[sym];
      const row = body.children[i];
      if (!row || !q) continue;
      const d = DEC(sym);
      const cls = pctCls(q.pct);
      const p = row.querySelector('.js-price');
      if (p) {
        p.textContent = fmtPrice(q.price, d);
        p.className = 'num js-price ' + cls;
      }
      const c = row.querySelector('.js-chg');
      if (c) {
        c.textContent = fmtChg(q.change, d);
        c.className = 'num js-chg ' + cls;
      }
      const pc = row.querySelector('.js-pct');
      if (pc) {
        pc.textContent = fmtPct(q.pct);
        pc.className = 'pct js-pct ' + cls;
      }
      const amt = row.querySelector('.js-amt');
      if (amt) amt.textContent = fmtAmt(q.amount);
      const dot = row.querySelector('.js-dot');
      if (dot) {
        const pos = q.high > q.low ? Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low)) * 100)) : 50;
        dot.style.left = pos.toFixed(1) + '%';
        dot.className = 'js-dot ' + cls;
      }
      const tag = row.querySelector('.js-tag');
      if (tag) {
        tag.textContent = STATUS_TEXT[q.status] || q.status;
        tag.className = 'tag js-tag ' + q.status;
      }
    }
  }

  function renderTitle() {
    const n = currentSymbols().length;
    const hint = n > 1 ? ' · 拖动行可排序' : '';
    if (S.group === 'all') {
      $('crumbTitle').textContent = '全部自选';
      $('crumbSub').textContent = n + ' 个标的' + hint;
    } else {
      const g = groupById(S.group);
      $('crumbTitle').textContent = g ? g.name : '—';
      $('crumbSub').textContent = (g && g.kind === 'industry' ? '行业 · ' : '') + n + ' 个标的' + hint;
    }
  }

  function renderStatus() {
    const left = $('statusLeft');
    const right = $('statusRight');
    const feed = $('tbFeed');
    if (S.paused) {
      left.innerHTML = '<span class="sb-dot warn"></span>已暂停刷新';
    } else if (S.error) {
      left.innerHTML = '<span class="sb-dot err"></span>' + esc(S.error.slice(0, 90));
    } else if (S.lastUpdate) {
      left.innerHTML = '<span class="sb-dot ok"></span>数据正常';
    } else {
      left.innerHTML = '<span class="sb-dot"></span>正在连接行情…';
    }
    const parts = [];
    if (S.lastUpdate) parts.push('更新于 ' + fmtClock(S.lastUpdate));
    if (S.source) parts.push('源 ' + S.source);
    parts.push(currentSymbols().length + ' 只');
    parts.push(S.paused ? '—' : '每 ' + (document.hidden ? S.data.settings.idleRefreshSec : S.data.settings.refreshSec) + ' 秒');
    right.textContent = parts.join(' · ');

    if (S.lastUpdate) {
      feed.innerHTML = '<b>' + fmtClock(S.lastUpdate) + '</b>' + (S.source ? ' · ' + esc(S.source) : '');
    } else {
      feed.textContent = '';
    }
  }

  // ---------- 行情轮询 ----------

  async function tick() {
    clearTimeout(S.timer);
    if (!S.data) return;
    refreshIndexes();
    if (S.view === 'detail' && DS.sym) {
      await refreshDetail(false);
      schedule();
      return;
    }
    const syms = currentSymbols();
    if (!syms.length || S.paused) {
      schedule();
      return;
    }
    // 与行情并行发起，别等报价回来再排队
    refreshSparklines(syms);
    try {
      const qs = await withTimeout(INV('get_quotes', { symbols: syms }), 8000, '行情请求');
      if (qs && qs.length) {
        const map = Object.assign({}, S.quotes);
        qs.forEach((q) => (map[q.symbol] = q));
        S.quotes = map;
        S.source = qs[0].source || '';
        S.error = '';
      }
      S.lastUpdate = new Date();
      if (!S.dragging) {
        renderRows();
        renderStatus();
      }
    } catch (e) {
      S.error = String(e && e.message ? e.message : e);
      renderStatus();
    }
    schedule();
  }

  function schedule() {
    clearTimeout(S.timer);
    const st = (S.data && S.data.settings) || {};
    if (S.paused) {
      S.timer = setTimeout(tick, 30000);
      return;
    }
    const sec = document.hidden ? st.idleRefreshSec || 15 : st.refreshSec || 3;
    S.timer = setTimeout(tick, Math.max(1, sec) * 1000);
  }

  // ---------- 弹窗 ----------

  const overlay = $('overlay');
  const modalHost = $('modalHost');

  function closeModal() {
    modalHost.innerHTML = '';
    overlay.classList.remove('on');
  }

  overlay.addEventListener('mousedown', closeModal);

  function mountModal(html) {
    overlay.classList.add('on');
    modalHost.innerHTML = '<div class="modal on">' + html + '</div>';
    return modalHost.firstElementChild;
  }

  let promptCb = null;
  function openPrompt(title, value, cb) {
    promptCb = cb;
    const m = mountModal(
      '<div class="modal-head">' + esc(title) + '<button class="close" id="pClose">✕</button></div>' +
        '<div class="form"><div class="field"><input type="text" id="pInput" value="' + esc(value) + '"></div></div>' +
        '<div class="modal-actions"><button class="btn" id="pCancel">取消</button><button class="btn primary" id="pOk">确定</button></div>'
    );
    const input = m.querySelector('#pInput');
    input.focus();
    input.select();
    const ok = () => {
      const v = input.value.trim();
      if (!v) return;
      const fn = promptCb;
      promptCb = null;
      closeModal();
      fn && fn(v);
    };
    m.querySelector('#pOk').onclick = ok;
    m.querySelector('#pCancel').onclick = closeModal;
    m.querySelector('#pClose').onclick = closeModal;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') ok();
      if (e.key === 'Escape') closeModal();
    };
  }

  function confirmBox(title, text, onOk) {
    const m = mountModal(
      '<div class="modal-head">' + esc(title) + '</div>' +
        '<div class="form"><div style="font-size:12.5px;color:var(--text2);line-height:1.6">' + esc(text) + '</div></div>' +
        '<div class="modal-actions"><button class="btn" id="cNo">取消</button><button class="btn danger" id="cYes">删除</button></div>'
    );
    m.querySelector('#cNo').onclick = closeModal;
    m.querySelector('#cYes').onclick = () => {
      closeModal();
      onOk();
    };
  }

  // ---------- 搜索添加 ----------

  async function openSearch() {
    S.hits = [];
    S.hitSel = 0;
    const m = mountModal(
      '<input class="search-input" id="qInput" placeholder="输入代码、名称或拼音首字母" autocomplete="off" spellcheck="false">' +
        '<div class="hits" id="qHits"><div class="hit-empty">输入关键词开始搜索，例如 600519 / 茅台 / 腾讯</div></div>' +
        '<div class="modal-foot"><span>↑↓ 选择</span><span>Enter 添加</span><span>Esc 关闭</span></div>'
    );
    const input = m.querySelector('#qInput');
    input.focus();

    let tmr = null;
    input.oninput = () => {
      clearTimeout(tmr);
      const v = input.value.trim();
      if (!v) {
        $('qHits').innerHTML = '<div class="hit-empty">输入关键词开始搜索</div>';
        return;
      }
      tmr = setTimeout(() => doSearch(v), 220);
    };
    input.onkeydown = async (e) => {
      if (e.key === 'Escape') return closeModal();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        S.hitSel = Math.min(S.hits.length - 1, S.hitSel + 1);
        paintHits();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        S.hitSel = Math.max(0, S.hitSel - 1);
        paintHits();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (S.hits.length) {
          await addHit(S.hits[S.hitSel]);
        } else if (v) {
          await addSymbolDirect(v);
        }
      }
    };
  }

  async function doSearch(q) {
    const seq = ++S.searchSeq;
    let hits = [];
    try {
      hits = await INV('search_symbols', { query: q });
    } catch (e) {
      hits = [];
    }
    if (seq !== S.searchSeq) return;
    S.hits = hits || [];
    S.hitSel = 0;
    paintHits(q);
  }

  function paintHits(q) {
    const box = $('qHits');
    if (!box) return;
    if (!S.hits.length) {
      const looksCode = /^[a-zA-Z]{0,2}\d{4,6}$/.test((q || '').trim());
      box.innerHTML =
        '<div class="hit-empty">没有匹配结果' +
        (looksCode ? '<div style="margin-top:10px"><button class="btn tiny" id="qDirect">直接添加 ' + esc(q.trim()) + '</button></div>' : '') +
        '<div style="margin-top:8px;font-size:11px;color:var(--text3)">也可以直接输入 6 位 A 股代码或 5 位港股代码后回车</div></div>';
      const b = $('qDirect');
      if (b) b.onclick = () => addSymbolDirect(q.trim());
      return;
    }
    const KIND_LABEL = { etf: 'ETF', index: '指数', fund: '场外', stock: '' };
    box.innerHTML = S.hits
      .map((h, i) => {
        const kd = KIND_LABEL[h.kind] || '';
        const owned = (S.data.instruments || []).some((x) => x.symbol === h.symbol);
        return (
          '<div class="hit' + (i === S.hitSel ? ' sel' : '') + '" data-i="' + i + '">' +
          (kd ? '<span class="kd">' + kd + '</span>' : '') +
          '<span class="nm">' + esc(h.name) + '</span>' +
          '<span class="mk">' + esc(h.market) + '</span>' +
          '<span class="cd">' + esc(h.code) + '</span>' +
          (owned ? '<span class="own">已添加</span>' : '') +
          '</div>'
        );
      })
      .join('');
    box.querySelectorAll('.hit').forEach((el) => {
      el.onmouseenter = () => {
        S.hitSel = +el.dataset.i;
        box.querySelectorAll('.hit').forEach((x, j) => x.classList.toggle('sel', j === S.hitSel));
      };
      el.onclick = () => addHit(S.hits[+el.dataset.i]);
    });
  }

  async function addHit(h) {
    if (!h) return;
    await addSymbolDirect(h.symbol, h.name);
  }

  async function addSymbolDirect(sym, name) {
    const target = S.group === 'all' ? firstWatchGroup() : S.group;
    if (!target) {
      toast('请先创建一个自选分组');
      return;
    }
    const already = S.data.members.some((m) => m.groupId === target && m.symbol === sym);
    if (already) {
      toast((name || sym) + ' 已在该分组');
      return;
    }
    try {
      S.data = await INV('add_symbol', { symbol: sym, groupId: target });
      closeModal();
      render();
      tick();
      toast('已添加 ' + (name || sym));
    } catch (e) {
      toast('添加失败：' + String(e));
    }
  }

  function firstWatchGroup() {
    const g = (S.data.groups || []).filter((x) => x.kind === 'watch').sort((a, b) => a.sort - b.sort)[0];
    return g ? g.id : null;
  }

  // ---------- 设置 ----------

  function openSettings() {
    const s = S.data.settings;
    const groups = (S.data.groups || []).filter((g) => g.kind === 'watch');
    const m = mountModal(
      '<div class="modal-head">设置<button class="close" id="sClose">✕</button></div>' +
        '<div class="form">' +
        '<div class="row2">' +
        '<div class="field"><label>前台刷新间隔（秒）</label><input type="number" id="sRefresh" min="1" max="60" value="' + s.refreshSec + '"><div class="hint">窗口可见时的轮询间隔</div></div>' +
        '<div class="field"><label>后台刷新间隔（秒）</label><input type="number" id="sIdle" min="5" max="300" value="' + s.idleRefreshSec + '"><div class="hint">窗口隐藏后自动降频</div></div>' +
        '</div>' +
        '<div class="row2">' +
        '<div class="field"><label>托盘浮层显示</label><select id="sFlyGroup">' +
        '<option value="">全部自选</option>' +
        groups.map((g) => '<option value="' + esc(g.id) + '"' + (s.flyoutGroup === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>浮层最多显示行数</label><input type="number" id="sFlyLimit" min="3" max="20" value="' + s.flyoutLimit + '"></div>' +
        '</div>' +
        '<div class="field"><label>涨跌配色</label><select id="sColor"><option value="cn"' + (s.colorMode === 'cn' ? ' selected' : '') + '>红涨绿跌（A 股习惯）</option><option value="intl"' + (s.colorMode === 'intl' ? ' selected' : '') + '>绿涨红跌（国际习惯）</option></select></div>' +
        '<div style="display:flex;gap:22px;padding-top:2px">' +
        '<label class="switch"><input type="checkbox" id="sAmt"' + (s.showAmount ? ' checked' : '') + '>显示成交额</label>' +
        '<label class="switch"><input type="checkbox" id="sRange"' + (s.showRange ? ' checked' : '') + '>显示日内区间</label>' +
        '</div>' +
        '</div>' +
        '<div class="modal-actions"><button class="btn danger" id="sQuit">退出程序</button><span style="flex:1"></span><button class="btn" id="sCancel">取消</button><button class="btn primary" id="sSave">保存</button></div>'
    );
    m.querySelector('#sClose').onclick = closeModal;
    m.querySelector('#sCancel').onclick = closeModal;
    m.querySelector('#sQuit').onclick = () => INV('quit_app');
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
      try {
        S.data = await INV('update_settings', { settings: next });
        closeModal();
        render();
        toast('设置已保存');
      } catch (e) {
        toast('保存失败：' + String(e));
      }
    };
  }

  // ---------- 右键菜单 ----------

  const menu = $('ctxMenu');
  function hideMenu() {
    menu.classList.remove('on');
    menu.innerHTML = '';
  }
  function showMenu(x, y, items) {
    menu.innerHTML = items
      .map((it, i) =>
        it.sep
          ? '<div class="sep"></div>'
          : '<div class="mi ' + (it.danger ? 'danger' : '') + '" data-i="' + i + '">' + esc(it.label) +
            (it.hint ? '<span class="k">' + esc(it.hint) + '</span>' : '') + '</div>'
      )
      .join('');
    menu.classList.add('on');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    menu.onclick = (e) => {
      const el = e.target.closest('.mi');
      if (!el) return;
      const it = items[+el.dataset.i];
      hideMenu();
      if (it && it.onClick) it.onClick();
    };
  }
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target)) hideMenu();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 操作 ----------

  async function call(cmd, args, doneMsg) {
    try {
      S.data = await INV(cmd, args || {});
      render();
      if (doneMsg) toast(doneMsg);
      return true;
    } catch (e) {
      toast('操作失败：' + String(e));
      return false;
    }
  }

  function toast(msg, actionLabel, action) {
    const t = $('toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button id="toastAct">' + esc(actionLabel) + '</button>' : '');
    t.classList.add('on');
    const btn = $('toastAct');
    if (btn) btn.onclick = () => { t.classList.remove('on'); action && action(); };
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // ---------- 事件绑定 ----------

  $('sidebar').addEventListener('click', (e) => {
    const add = e.target.closest('.add');
    if (add) {
      const kind = add.dataset.new;
      openPrompt(kind === 'industry' ? '新建行业分类' : '新建自选分组', '', (v) => call('add_group', { kind, name: v, parentId: null }, '已创建'));
      return;
    }
    const row = e.target.closest('.grp');
    if (!row) return;
    const gid = row.dataset.gid;
    const caret = e.target.closest('.caret');
    if (caret && gid !== 'all') {
      const g = groupById(gid);
      if (g) {
        call('toggle_group', { id: gid, collapsed: !g.collapsed });
        return;
      }
    }
    if (S.view === 'detail') {
      S.view = 'list';
      S.detailSym = null;
      DS.sym = null;
      document.querySelector('.content').classList.remove('detail-mode');
      const dv = $('detail');
      dv.classList.remove('on');
      dv.innerHTML = '';
    }
    S.group = gid;
    render();
    tick();
  });

  $('sidebar').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.grp');
    if (!row || row.dataset.gid === 'all') return;
    const g = groupById(row.dataset.gid);
    if (!g) return;
    openPrompt('重命名分组', g.name, (v) => call('rename_group', { id: g.id, name: v }));
  });

  $('sidebar').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.grp');
    if (!row || row.dataset.gid === 'all') return;
    e.preventDefault();
    const g = groupById(row.dataset.gid);
    if (!g) return;
    const items = [
      { label: '重命名', onClick: () => openPrompt('重命名分组', g.name, (v) => call('rename_group', { id: g.id, name: v })) },
      { label: g.kind === 'industry' ? '新建子行业' : '新建子分组', onClick: () => openPrompt('新建子分组', '', (v) => call('add_group', { kind: g.kind, name: v, parentId: g.id })) },
      { label: '上移', onClick: () => moveGroupRelative(g, -1) },
      { label: '下移', onClick: () => moveGroupRelative(g, 1) },
      { sep: true },
      { label: '删除', danger: true, onClick: () => confirmBox('删除分组', '将删除「' + g.name + '」及其所有子分组，分组内的标的会一并移除（不影响其他分组）。', () => call('delete_group', { id: g.id }, '已删除')) },
    ];
    showMenu(e.clientX, e.clientY, items);
  });

  async function moveGroupRelative(g, delta) {
    const sibs = (S.data.groups || [])
      .filter((x) => x.parentId === g.parentId && x.kind === g.kind)
      .sort((a, b) => a.sort - b.sort);
    const idx = sibs.findIndex((x) => x.id === g.id);
    const next = idx + delta;
    if (next < 0 || next >= sibs.length) return;
    await call('move_group', { id: g.id, parentId: g.parentId, index: next });
  }

  $('tbody').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (S.justDragged) return;
    openDetail(row.dataset.symbol);
  });

  $('tbody').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    const sym = row.dataset.symbol;
    const ins = S.data.instruments.find((i) => i.symbol === sym) || { name: sym };
    const groups = (S.data.groups || []).filter((g) => g.kind === 'watch' && g.id !== S.group);
    const menuItems = [];
    menuItems.push({ label: '上移', onClick: () => moveRow(sym, -1) });
    menuItems.push({ label: '下移', onClick: () => moveRow(sym, 1) });
    menuItems.push({ sep: true });
    groups.forEach((g) => menuItems.push({ label: '　' + g.name, onClick: () => call('move_symbol', { symbol: sym, fromGroup: S.group, toGroup: g.id }, '已移动') }));
    if (menuItems.length) menuItems.push({ sep: true });
    if (S.group !== 'all') {
      menuItems.push({ label: '从本组移除', danger: true, onClick: () => call('remove_symbol', { symbol: sym, groupId: S.group }, '已移除') });
    }
    menuItems.push({ label: '删除自选', danger: true, onClick: () => removeEverywhere(sym, ins.name) });
    showMenu(e.clientX, e.clientY, menuItems.length ? menuItems : [{ label: '无可用操作' }]);
  });

  async function moveRow(sym, delta) {
    if (S.sortKey) {
      // 按列排序时列表顺序是实时算出来的，手动移动没有意义，先恢复自定义顺序。
      S.sortKey = null;
      S.sortDir = 1;
      renderHead();
    }
    const list = currentSymbols();
    const i = list.indexOf(sym);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = list.slice();
    next.splice(i, 1);
    next.splice(j, 0, sym);
    S.rowSig = null;
    const ok = await call('reorder_symbols', { groupId: S.group, symbols: next });
    if (ok) toast(delta < 0 ? '已上移' : '已下移');
    tick();
  }

  async function removeEverywhere(sym, name) {
    const ids = S.data.members.filter((m) => m.symbol === sym).map((m) => m.groupId);
    for (const gid of ids) {
      S.data = await INV('remove_symbol', { symbol: sym, groupId: gid });
    }
    render();
    toast('已删除 ' + (name || sym));
  }

  $('thead').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-sort]');
    if (!cell) return;
    const k = cell.dataset.sort;
    if (!k) return;
    if (S.sortKey === k) {
      S.sortDir = -S.sortDir;
      if (S.sortDir === 1) S.sortKey = null;
    } else {
      S.sortKey = k;
      S.sortDir = -1;
    }
    renderHead();
    renderRows();
  });

  $('btnAdd').onclick = openSearch;
  $('searchTrigger').onclick = openSearch;
  $('btnSettings').onclick = openSettings;
  $('btnMin').onclick = () => WIN.minimize();
  $('btnClose').onclick = () => WIN.close();
  $('btnMax').onclick = async () => {
    const max = await WIN.isMaximized();
    if (max) WIN.unmaximize();
    else WIN.maximize();
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === 'Escape') {
      if (overlay.classList.contains('on')) {
        closeModal();
        return;
      }
      if (S.view === 'detail') {
        closeDetail();
        return;
      }
      hideMenu();
      return;
    }
    if (S.view === 'detail' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const list = currentSymbols();
      const i = list.indexOf(DS.sym);
      const ni = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (i >= 0 && ni >= 0 && ni < list.length) {
        e.preventDefault();
        openDetail(list[ni]);
      }
    }
  });

  // ---------- 拖拽 ----------

  $('tbody').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (S.sortKey) {
      S.sortKey = null;
      S.sortDir = 1;
      renderHead();
      renderRows();
      e.preventDefault();
      toast('已切回自定义顺序，请再拖一次');
      return;
    }
    S.dragging = row.dataset.symbol;
    S.justDragged = false;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', S.dragging); } catch (_) {}
  });

  $('tbody').addEventListener('dragend', () => {
    S.dragging = null;
    S.justDragged = true;
    setTimeout(() => { S.justDragged = false; }, 120);
    document.querySelectorAll('.row.dragging').forEach((r) => r.classList.remove('dragging'));
    document.querySelectorAll('.row.drop-above,.row.drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    document.querySelectorAll('.grp.drag-over').forEach((r) => r.classList.remove('drag-over'));
  });

  $('tbody').addEventListener('dragover', (e) => {
    const row = e.target.closest('.row');
    if (!row || !S.dragging) return;
    e.preventDefault();
    document.querySelectorAll('.row.drop-above,.row.drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY - rect.top < rect.height / 2 ? 'drop-above' : 'drop-below');
  });

  $('tbody').addEventListener('drop', async (e) => {
    const row = e.target.closest('.row');
    if (!row || !S.dragging) return;
    e.preventDefault();
    const target = row.dataset.symbol;
    const moving = S.dragging;
    if (target === moving) return;
    const list = currentSymbols().filter((s) => s !== moving);
    const at = list.indexOf(target);
    const before = row.classList.contains('drop-above');
    if (at < 0) return;
    list.splice(before ? at : at + 1, 0, moving);
    S.rowSig = null;
    await call('reorder_symbols', { groupId: S.group, symbols: list });
    tick();
  });

  $('sidebar').addEventListener('dragover', (e) => {
    const row = e.target.closest('.grp');
    if (!row || !S.dragging) return;
    if (row.dataset.gid === 'all') return;
    e.preventDefault();
    document.querySelectorAll('.grp.drag-over').forEach((r) => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  $('sidebar').addEventListener('dragleave', (e) => {
    const row = e.target.closest('.grp');
    if (row) row.classList.remove('drag-over');
  });

  $('sidebar').addEventListener('drop', async (e) => {
    const row = e.target.closest('.grp');
    if (!row || !S.dragging) return;
    e.preventDefault();
    const gid = row.dataset.gid;
    row.classList.remove('drag-over');
    if (gid === 'all') return;
    const sym = S.dragging;
    if (S.group === 'all') {
      // 从「全部自选」拖到某个分组：加入该分组
      await call('add_symbol', { symbol: sym, groupId: gid }, '已加入分组');
    } else {
      await call('move_symbol', { symbol: sym, fromGroup: S.group, toGroup: gid }, '已移动');
    }
    tick();
  });

  // ---------- 托盘事件 ----------

  EVT.listen('toggle-pause', () => {
    S.paused = !S.paused;
    renderStatus();
    toast(S.paused ? '已暂停刷新' : '已恢复刷新');
    if (!S.paused) tick();
  }).catch(() => {});


  // ---------- 个股详情 ----------
  const DS = { sym: null, data: null, minute: [], minuteSym: null, minuteAt: 0, period: 'minute', kline: {}, kview: { start: 0, count: 120 } };

  const cssVar = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
  const fmtN = (v, d) => (v == null || v === 0 ? '—' : v.toFixed(d));
  const fmtVol = (v) => {
    if (!v) return '—';
    const lots = v / 100;
    if (lots >= 1e8) return (lots / 1e8).toFixed(2) + '亿手';
    if (lots >= 1e4) return (lots / 1e4).toFixed(2) + '万手';
    return Math.round(lots).toLocaleString() + '手';
  };
  const fmtCap = (v) => {
    if (!v) return '—';
    if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
    return (v / 1e8).toFixed(2) + '亿';
  };

  async function openDetail(sym) {
    DS.sym = sym;
    DS.data = null;
    DS.minute = [];
    DS.minuteSym = null;
    DS.period = 'minute';
    DS.kline = {};
    DS.kview = { start: 0, count: 120 };
    S.view = 'detail';
    S.detailSym = sym;
    document.querySelector('.content').classList.add('detail-mode');
    const el = $('detail');
    el.classList.add('on');
    el.innerHTML = '<div class="d-loading">加载中…</div>';
    el.scrollTop = 0;
    await refreshDetail(true);
  }

  function closeDetail() {
    S.view = 'list';
    S.detailSym = null;
    DS.sym = null;
    document.querySelector('.content').classList.remove('detail-mode');
    const el = $('detail');
    el.classList.remove('on');
    el.innerHTML = '';
    render();
    tick();
  }

  async function refreshDetail(withMinute) {
    const sym = DS.sym;
    if (!sym) return;
    try {
      const d = await withTimeout(INV('get_detail', { symbol: sym }), 8000, '详情请求');
      if (DS.sym !== sym) return;
      DS.data = d;
      const stale = DS.minuteSym !== sym || Date.now() - DS.minuteAt > 20000;
      if (withMinute || stale) {
        try {
          const m = await INV('get_minute', { symbol: sym });
          if (DS.sym === sym) {
            DS.minute = m;
            DS.minuteSym = sym;
            DS.minuteAt = Date.now();
          }
        } catch (e) {
          if (DS.minuteSym !== sym) DS.minute = [];
        }
      }
      renderDetail();
    } catch (e) {
      $('detail').innerHTML = '<div class="d-err">行情加载失败：' + esc(String(e)) + '</div>';
    }
  }

  function drawMinute(points, prev, rise) {
    const W = 720, H = 134, PX = 4, PY = 8;
    if (!points || points.length < 2) {
      return '<div style="height:150px;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11.5px">暂无分时数据</div>';
    }
    const vals = points.map((p) => p.price).concat(points.map((p) => p.avg || p.price));
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (prev) {
      min = Math.min(min, prev);
      max = Math.max(max, prev);
    }
    if (max - min < 1e-9) max = min + 0.01;
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;

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
      grid += '<line x1="' + PX + '" y1="' + gy + '" x2="' + (W - PX) + '" y2="' + gy + '" stroke="#24242b" stroke-width="1"/>';
    }
    let base = '';
    if (prev) {
      const by = y(prev).toFixed(1);
      base = '<line x1="' + PX + '" y1="' + by + '" x2="' + (W - PX) + '" y2="' + by + '" stroke="#5c5c6a" stroke-width="1" stroke-dasharray="3 4"/>';
    }

    let avgPath = '';
    if (points[0] && points[0].avg) {
      let al = '';
      for (let i = 0; i < n; i++) al += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(points[i].avg).toFixed(1);
      avgPath = '<path d="' + al + '" fill="none" stroke="#e8c46a" stroke-width="1" stroke-opacity="0.9"/>';
    }

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      grid + base +
      '<path d="' + area + '" fill="' + col + '" fill-opacity="0.10" stroke="none"/>' +
      '<path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      avgPath +
      '</svg>'
    );
  }

  function renderDetail() {
    const d = DS.data;
    if (!d) return;
    const q = d.quote;
    const sym = q.symbol;
    const ins = S.data.instruments.find((i) => i.symbol === sym) || {
      name: q.name,
      code: sym.slice(2),
      market: sym.slice(0, 2).toUpperCase(),
    };
    const dec = ins.kind === 'etf' ? 3 : sym.startsWith('hk') ? 3 : 2;
    const cls = pctCls(q.pct);
    const st = q.status;
    const rise = q.pct >= 0;

    const cells = [
      ['今开', fmtN(q.open, dec), q.open && q.prevClose ? (q.open >= q.prevClose ? 'up' : 'down') : ''],
      ['昨收', fmtN(q.prevClose, dec), ''],
      ['最高', fmtN(q.high, dec), q.high && q.prevClose && q.high >= q.prevClose ? 'up' : q.high ? 'down' : ''],
      ['最低', fmtN(q.low, dec), q.low && q.prevClose ? (q.low >= q.prevClose ? 'up' : 'down') : ''],
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

    const grid = cells
      .map(
        (c) =>
          '<div class="d-cell"><span class="k">' + c[0] + '</span><span class="v ' + (c[2] || '') + '">' + c[1] + '</span></div>'
      )
      .join('');

    const lvHtml = (list, prefix) =>
      list
        .map((l, i) => {
          const lc = l.price >= q.prevClose ? 'up' : 'down';
          return (
            '<div class="lv"><span class="s">' + prefix + '五档'.slice(0, 0) + (i + 1) + '</span>' +
            '<span class="p ' + lc + '">' + l.price.toFixed(dec) + '</span>' +
            '<span class="q">' + Math.round(l.volume).toLocaleString() + '</span></div>'
          );
        })
        .join('');

    const asks = (d.asks || []).slice().reverse();
    const bids = d.bids || [];
    const book =
      '<h3>五档盘口</h3>' +
      lvHtml(asks, '卖') +
      '<div class="lv-sep"></div>' +
      lvHtml(bids, '买');

    const axis = DS.period === 'minute' && DS.minute.length
      ? '<div class="d-axis"><span>' + DS.minute[0].t + '</span><span>' +
        DS.minute[Math.floor(DS.minute.length / 2)].t + '</span><span>' +
        DS.minute[DS.minute.length - 1].t + '</span></div>'
      : '';

    const chart =
      '<div class="d-chart">' +
      '<div class="d-chart-head">' +
      '<div class="d-tabs">' +
      PERIODS.map((p) => '<span data-p="' + p + '" class="' + (DS.period === p ? 'on' : '') + '">' + TAB_NAME[p] + '</span>').join('') +
      '</div>' +
      '<span class="d-chart-note">' + (DS.period === 'minute' ? '昨收 ' + fmtN(q.prevClose, dec) : '前复权 · MA5/10/20 · 滚轮缩放 · 拖拽平移') + '</span>' +
      '</div>' +
      '<div class="d-chart-body" id="dChartBody"><div class="chart-svg-wrap" id="chartWrap">' + chartSvg(q, dec) + '</div>' + axis +
      '<div class="cx-line" id="cxLine"></div><div class="cx-tip" id="cxTip"></div></div>' +
      '</div>';

    $('detail').innerHTML =
      '<div class="d-top"><button class="d-back" id="dBack" title="返回">←</button>' +
      '<div class="d-id"><h2>' + esc(ins.name) + '</h2><span>' + esc(ins.code) + ' · ' + esc(ins.market) + '</span></div>' +
      '<span class="tag ' + st + '">' + (STATUS_TEXT[st] || st) + '</span></div>' +
      '<div class="d-hero"><span class="d-price ' + cls + '">' + fmtPrice(q.price, dec) + '</span>' +
      '<span class="d-change"><span class="' + cls + '">' + fmtChg(q.change, dec) + '</span>' +
      '<span class="' + cls + '">' + fmtPct(q.pct) + '</span></span>' +
      '<span class="d-meta">' + esc(q.time) + ' · ' + esc(q.source) + '</span></div>' +
      chart +
      '<div class="d-cols"><div class="d-grid">' + grid + '</div><div class="d-book">' + book + '</div></div>';

    const back = $('dBack');
    if (back) back.onclick = closeDetail;
    $('detail').querySelectorAll('.d-tabs span').forEach((el) => {
      el.onclick = () => switchPeriod(el.dataset.p);
    });
    bindChart();
  }

  function resetKview() {
    const all = DS.kline[DS.period] || [];
    const total = all.length || 1;
    DS.kview.count = Math.min(120, total);
    DS.kview.start = Math.max(0, total - DS.kview.count);
  }

  function renderChartOnly() {
    const wrap = $('chartWrap');
    if (!wrap || !DS.data) return;
    const q = DS.data.quote;
    const ins = S.data.instruments.find((i) => i.symbol === q.symbol) || {};
    const dec = ins.kind === 'etf' ? 3 : q.symbol.startsWith('hk') ? 3 : 2;
    wrap.innerHTML = chartSvg(q, dec);
    bindChartHover();
  }

  /// 滚轮缩放、拖拽平移、双击复位——这是行情软件图表最基础的手感。
  function bindChart() {
    bindChartHover();
    const body = $('dChartBody');
    if (!body) return;
    if (DS.period === 'minute') {
      body.onwheel = null;
      body.onmousedown = null;
      body.ondblclick = null;
      return;
    }

    body.onwheel = (e) => {
      e.preventDefault();
      const total = (DS.kline[DS.period] || []).length;
      if (total < 30) return;
      const v = DS.kview;
      const oldC = v.count;
      let next = Math.round(oldC * (e.deltaY > 0 ? 1.16 : 0.86));
      next = Math.max(25, Math.min(total, next));
      if (next === oldC) return;
      const rect = body.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const anchor = v.start + oldC * ratio;
      v.count = next;
      v.start = Math.max(0, Math.min(total - next, Math.round(anchor - next * ratio)));
      renderChartOnly();
    };

    body.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = body.getBoundingClientRect();
      const x0 = e.clientX;
      const s0 = DS.kview.start;
      const pxPerBar = rect.width / DS.kview.count;
      const total = (DS.kline[DS.period] || []).length;
      const onMove = (ev) => {
        const delta = Math.round((x0 - ev.clientX) / pxPerBar);
        const ns = Math.max(0, Math.min(total - DS.kview.count, s0 + delta));
        if (ns !== DS.kview.start) {
          DS.kview.start = ns;
          renderChartOnly();
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        body.style.cursor = '';
      };
      body.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    body.ondblclick = () => {
      resetKview();
      renderChartOnly();
    };
  }

  const PERIODS = ['minute', 'day', 'week', 'month'];
  const TAB_NAME = { minute: '分时', day: '日K', week: '周K', month: '月K' };

  function chartSvg(q, dec) {
    if (DS.period === 'minute') {
      return drawMinute(DS.minute, q.prevClose, q.pct >= 0);
    }
    const arr = DS.kline[DS.period];
    if (arr === undefined) return '<div class="chart-empty">加载中…</div>';
    if (!arr.length) return '<div class="chart-empty">暂无 K 线数据</div>';
    return drawKline(arr);
  }

  async function switchPeriod(p) {
    DS.period = p;
    DS.kview = { start: 0, count: 120 };
    if (p !== 'minute' && DS.kline[p] === undefined) {
      renderDetail();
      try {
        const arr = await INV('get_kline', { symbol: DS.sym, period: p, limit: p === 'day' ? 160 : 90 });
        DS.kline[p] = arr || [];
      } catch (e) {
        DS.kline[p] = [];
      }
      resetKview();
    }
    renderDetail();
  }

  /// 蜡烛图：上半价格、下半成交量，叠加 MA5/MA10/MA20。
  function drawKline(all) {
    const W = 720, H = 134, PX = 4, PY = 6;
    const volH = 32;
    const priceH = H - volH - 8;
    const total = all.length;
    const start = Math.max(0, Math.min(DS.kview.start, Math.max(0, total - 1)));
    const count = Math.max(20, Math.min(DS.kview.count, total));
    const candles = all.slice(start, start + count);
    const n = candles.length;
    let min = Infinity, max = -Infinity, maxV = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.volume > maxV) maxV = c.volume;
    }
    if (!isFinite(min) || !isFinite(max) || max <= min || n < 2) {
      return '<div class="chart-empty">暂无 K 线数据</div>';
    }
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
      const yo = y(c.open), yc = y(c.close);
      const top = Math.min(yo, yc);
      const hgt = Math.max(1, Math.abs(yc - yo));
      bars += '<rect x="' + (xc - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" fill="' + col + '"/>';
      bars += '<rect x="' + (xc - bw / 2).toFixed(1) + '" y="' + yv(c.volume).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, H - yv(c.volume)).toFixed(1) + '" fill="' + col + '" fill-opacity="0.5"/>';
    }

    const ma = (k, color) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        if (i < k - 1) continue;
        let sum = 0;
        for (let j = 0; j < k; j++) {
          const idx = start + i - j;
          if (idx < 0) { sum = NaN; break; }
          sum += all[idx].close;
        }
        if (isNaN(sum)) continue;
        pts.push(x(i).toFixed(1) + ' ' + y(sum / k).toFixed(1));
      }
      return pts.length > 1
        ? '<polyline points="' + pts.join(',') + '" fill="none" stroke="' + color + '" stroke-width="1" stroke-opacity="0.85"/>'
        : '';
    };

    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const gy = (PY + (i / 3) * (priceH - PY)).toFixed(1);
      grid += '<line x1="' + PX + '" y1="' + gy + '" x2="' + (W - PX) + '" y2="' + gy + '" stroke="#24242b" stroke-width="1"/>';
    }

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      grid + bars + ma(5, '#e8c46a') + ma(10, '#6aa8ff') + ma(20, '#b07ae0') + '</svg>'
    );
  }

  function bindChartHover() {
    const body = $('dChartBody');
    const line = $('cxLine');
    const tip = $('cxTip');
    if (!body || !line || !tip) return;
    const isMinute = DS.period === 'minute';
    const full = isMinute ? DS.minute : DS.kline[DS.period] || [];
    const arr = isMinute ? full : full.slice(DS.kview.start, DS.kview.start + DS.kview.count);
    if (arr.length < 2) return;
    const q = DS.data.quote;
    const sym = q.symbol;
    const ins = S.data.instruments.find((i) => i.symbol === sym) || {};
    const dec = ins.kind === 'etf' ? 3 : sym.startsWith('hk') ? 3 : 2;

    body.onmousemove = (e) => {
      const r = body.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const i = Math.round(ratio * (arr.length - 1));
      const px = (i / (arr.length - 1)) * r.width;
      line.style.display = 'block';
      line.style.left = px.toFixed(0) + 'px';
      tip.style.display = 'block';
      tip.style.left = Math.min(px + 12, r.width - 158).toFixed(0) + 'px';
      if (isMinute) {
        const p = arr[i];
        const pct = q.prevClose ? ((p.price - q.prevClose) / q.prevClose) * 100 : 0;
        tip.innerHTML = '<b>' + p.t + '</b> ' + p.price.toFixed(dec) + '<br>' + fmtPct(pct);
      } else {
        const c = arr[i];
        tip.innerHTML =
          '<b>' + c.date + '</b><br>开 ' + c.open.toFixed(2) + '  收 ' + c.close.toFixed(2) +
          '<br>高 ' + c.high.toFixed(2) + '  低 ' + c.low.toFixed(2);
      }
    };
    body.onmouseleave = () => {
      line.style.display = 'none';
      tip.style.display = 'none';
    };
  }

  // ---------- 大盘指数 ----------
  const INDEXES = ['sh000001', 'sz399001', 'sz399006', 'hkHSI'];

  function renderIndexes(qs) {
    const box = $('indexbar');
    if (!box || !qs || !qs.length) return;
    const map = {};
    qs.forEach((q) => (map[q.symbol] = q));
    box.innerHTML = INDEXES.map((sym) => {
      const q = map[sym];
      if (!q) return '';
      const cls = pctCls(q.pct);
      return (
        '<div class="idx"><span class="n">' + esc(q.name) + '</span>' +
        '<span class="v ' + cls + '">' + q.price.toFixed(2) + '</span>' +
        '<span class="p ' + cls + '">' + fmtPct(q.pct) + '</span></div>'
      );
    }).join('');
  }

  let idxBusy = false;
  async function refreshIndexes() {
    if (idxBusy) return;
    idxBusy = true;
    try {
      const qs = await withTimeout(INV('get_quotes', { symbols: INDEXES }), 8000, '指数请求');
      renderIndexes(qs);
    } catch (e) {
    } finally {
      idxBusy = false;
    }
  }

  // ---------- 启动 ----------

  async function boot() {
    try {
      S.data = await INV('get_state');
    } catch (e) {
      $('statusLeft').textContent = '初始化失败：' + String(e);
      return;
    }
    render();
    tick();
    setInterval(() => {
      if (S.lastUpdate) $('tbFeed').innerHTML = '<b>' + fmtClock(S.lastUpdate) + '</b>' + (S.source ? ' · ' + esc(S.source) : '');
    }, 1000);
  }

  boot();
})();
