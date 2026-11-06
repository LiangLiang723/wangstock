/* 导航层：全部自选 / 自选分组树 / 行业分类树，以及分组的可见操作。 */
import { $, esc, state, actions, call, toast, showMenu, openPrompt, confirmBox } from './core.js';
import { countOf, groupById } from './format.js';

const CARET = '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1.5 2.5L4 5.5L6.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const PALETTE = [
  { c: '#6ea8ff', n: '蓝色' }, { c: '#b48cf2', n: '紫色' }, { c: '#4fbf8b', n: '绿色' },
  { c: '#e8a33d', n: '橙色' }, { c: '#e06c75', n: '红色' },
];

function childrenOf(parentId, kind) {
  return (state.data?.groups || [])
    .filter((g) => g.kind === kind && (g.parentId || null) === parentId)
    .sort((a, b) => a.sort - b.sort);
}

function treeHtml(parentId, kind, depth) {
  return childrenOf(parentId, kind).map((g) => {
    const kids = childrenOf(g.id, kind);
    const on = state.group === g.id && state.view === 'list';
    const collapsed = !!g.collapsed;
    const dot = g.color ? '<span class="color-dot" style="background:' + esc(g.color) + '"></span>' : '';
    return '<div class="nav-item' + (on ? ' on' : '') + '" data-gid="' + esc(g.id) + '" style="padding-left:' + (8 + depth * 13) + 'px">' +
      (kids.length
        ? '<span class="caret' + (collapsed ? ' closed' : '') + '" data-caret="1">' + CARET + '</span>'
        : '<span class="caret"></span>') +
      (dot || '<span class="ico" style="font-size:10px">' + (kind === 'industry' ? '◈' : '▤') + '</span>') +
      '<span class="nm">' + esc(g.name) + '</span>' +
      '<span class="cnt">' + countOf(g.id) + '</span>' +
      '<span class="acts">' +
      '<button class="iconbtn" data-act="add" title="新建子分组">＋</button>' +
      '<button class="iconbtn" data-act="more" title="更多">⋯</button>' +
      '</span></div>' +
      (!collapsed && kids.length ? treeHtml(g.id, kind, depth + 1) : '');
  }).join('');
}

export function renderSidebar() {
  if (!state.data) return;
  const allOn = state.group === 'all';
  $('sideScroll').innerHTML =
    '<div class="nav-label">工作台</div>' +
    '<div class="nav-item' + (allOn ? ' on' : '') + '" data-gid="all">' +
    '<span class="ico">◉</span><span class="nm">全部自选</span>' +
    '<span class="cnt">' + (state.data.order || []).length + '</span></div>' +
    '<div class="nav-label">自选分组' +
    '<button class="iconbtn" data-new="watch" title="新建分组">＋</button></div>' +
    treeHtml(null, 'watch', 0) +
    '<div class="nav-label">行业分类' +
    '<button class="iconbtn" data-new="industry" title="新建行业">＋</button></div>' +
    treeHtml(null, 'industry', 0);
}

async function moveGroupRelative(g, delta) {
  const sibs = (state.data.groups || [])
    .filter((x) => (x.parentId || null) === (g.parentId || null) && x.kind === g.kind)
    .sort((a, b) => a.sort - b.sort);
  const idx = sibs.findIndex((x) => x.id === g.id);
  const next = idx + delta;
  if (next < 0 || next >= sibs.length) return;
  await call('move_group', { id: g.id, parentId: g.parentId || null, index: next });
}

function groupMenu(g, x, y) {
  const items = [
    { heading: g.name },
    { label: '重命名', onClick: () => openPrompt('重命名', g.name, (v) => call('rename_group', { id: g.id, name: v })) },
    { label: '新建子' + (g.kind === 'industry' ? '行业' : '分组'), onClick: () => openPrompt('新建子分组', '', (v) => call('add_group', { kind: g.kind, name: v, parentId: g.id })) },
    { label: '上移', onClick: () => moveGroupRelative(g, -1) },
    { label: '下移', onClick: () => moveGroupRelative(g, 1) },
    { sep: true },
    { heading: '标记颜色' },
  ];
  PALETTE.forEach((p) => items.push({
    label: '　● ' + p.n, onClick: () => call('set_group_color', { id: g.id, color: p.c }),
  }));
  items.push({ label: '清除颜色', onClick: () => call('set_group_color', { id: g.id, color: null }) });
  items.push({ sep: true });
  items.push({
    label: '删除分组', danger: true, onClick: () => confirmBox(
      '删除分组', '将删除「' + g.name + '」及其子分组，分组内的标的会一并移除（不影响其他分组）。',
      () => call('delete_group', { id: g.id }, '已删除'), '删除'),
  });
  showMenu(x, y, items);
}

export function bindSidebar() {
  const box = $('sideScroll');

  box.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-new]');
    if (add) {
      const kind = add.dataset.new;
      openPrompt(kind === 'industry' ? '新建行业分类' : '新建自选分组', '',
        (v) => call('add_group', { kind, name: v, parentId: null }, '已创建'));
      return;
    }
    const row = e.target.closest('.nav-item');
    if (!row) return;
    const gid = row.dataset.gid;
    const act = e.target.closest('[data-act]');
    if (act) {
      const g = groupById(gid);
      if (!g) return;
      if (act.dataset.act === 'add') {
        openPrompt('新建子分组', '', (v) => call('add_group', { kind: g.kind, name: v, parentId: g.id }, '已创建'));
      } else {
        const r = act.getBoundingClientRect();
        groupMenu(g, r.right, r.bottom + 2);
      }
      return;
    }
    const caret = e.target.closest('[data-caret]');
    if (caret && gid !== 'all') {
      const g = groupById(gid);
      if (g) { await call('toggle_group', { id: gid, collapsed: !g.collapsed }); return; }
    }
    if (gid === 'all') {
      if (state.view === 'detail') actions.closeDetail && actions.closeDetail();
      state.group = 'all';
    } else {
      actions.setGroup && actions.setGroup(gid);
      return;
    }
    actions.render && actions.render();
    actions.refreshNow && actions.refreshNow();
  });

  box.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.nav-item');
    if (!row || row.dataset.gid === 'all') return;
    const g = groupById(row.dataset.gid);
    if (g) openPrompt('重命名', g.name, (v) => call('rename_group', { id: g.id, name: v }));
  });

  box.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.nav-item');
    if (!row || row.dataset.gid === 'all') return;
    e.preventDefault();
    const g = groupById(row.dataset.gid);
    if (g) groupMenu(g, e.clientX, e.clientY);
  });
}
