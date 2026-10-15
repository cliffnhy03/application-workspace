'use strict';
// Renders the whole window from one snapshot of the workspace (S). Every change goes through
// window.api to the main process, which saves it and hands back the fresh snapshot.

// `api` is the bridge defined in preload.js.
const isMac = api.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl ';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KIND_LABEL = { cv: 'CV', cover: 'Cover letter', other: 'Other' };
const KIND_TITLE = { cv: 'Tailored CV', cover: 'Cover letter', other: 'Other documents' };
const KIND_EMPTY = {
  cv: 'No CV stored for this application yet.',
  cover: 'No cover letter stored yet.',
  other: 'Application answers, job spec, offer letter…',
};
const NOTES_TEMPLATE = `Why this company
-

What they do / recent news
-

Talking points (my stories that fit this role)
-

People I've spoken to
-

Questions to ask
- `;

let S = null;
const ui = Object.assign({ view: 'dashboard', sel: null, filter: null, q: '', sort: 'due', docKind: 'all', docQ: '', moreOpen: false }, loadUi());

const $ = id => document.getElementById(id);

function loadUi() {
  try { return JSON.parse(localStorage.getItem('ui') || '{}'); } catch { return {}; }
}
function saveUi() {
  try { localStorage.setItem('ui', JSON.stringify({ view: ui.view, sel: ui.sel, sort: ui.sort, moreOpen: ui.moreOpen })); } catch { /* storage unavailable */ }
}

// Build DOM nodes. Strings become text nodes, so user data never becomes markup.
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  if (value !== undefined) e.value = value;
  return e;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

/* ---------- dates and formatting ---------- */
function daysUntil(s) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 864e5);
}
function fmtDay(y, m, d) { return `${d} ${MON[m]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; }
function fmtDate(s) { const [y, m, d] = s.split('-').map(Number); return fmtDay(y, m - 1, d); }
function fmtWhen(iso) { const d = new Date(iso); return fmtDay(d.getFullYear(), d.getMonth(), d.getDate()); }
function fmtSize(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return fmtWhen(iso);
}
function dueInfo(a) {
  if (!a.due) return null;
  const days = daysUntil(a.due);
  const text = days < 0 ? (days === -1 ? '1 day ago' : `${-days} days ago`) : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return { days, text, label: fmtDate(a.due), cls: days < 0 ? 'late' : days <= 7 ? 'soon' : '' };
}
function dueChip(a) {
  const i = dueInfo(a);
  return i && h('span', { class: `due ${i.cls}` }, `${i.label} · ${i.text}`);
}

/* ---------- data helpers ---------- */
const STAGES = () => S.stages;
const OFFER = () => S.stages.indexOf('Offer');
const REJECTED = () => S.stages.indexOf('Rejected');
const isActive = a => a.stage < OFFER();
const isInterview = a => ['Video interview', 'Interview'].includes(S.stages[a.stage]);
// What the next step usually is on arriving at a stage, so moving forward doesn't leave stale text.
const NEXT_ON_ARRIVAL = { Applied: 'Awaiting response', 'Online test': 'Complete online test', 'Video interview': 'Record video interview', Interview: 'Prepare for interview' };
const appById = id => S.applications.find(a => a.id === id);
const filesFor = (appId, kind) => S.files.filter(f => f.appId === appId && (!kind || f.kind === kind))
  .sort((x, y) => y.addedAt.localeCompare(x.addedAt));
const library = () => filesFor(null);
const stagePill = a => h('span', { class: `pill s${a.stage}` }, STAGES()[a.stage]);

async function run(promise, { quiet = false } = {}) {
  const r = await promise;
  if (r.state) S = r.state;
  if (!r.ok) toast(r.error, true);
  if (!quiet) render();
  return r;
}

let toastTimer;
function toast(msg, bad = false, action = null) {
  const t = $('toast');
  t.replaceChildren(msg);
  if (action) t.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad || action ? 7000 : 3000);
}

// Every stage change offers an Undo, so a misclick is one click to fix.
async function moveStage(a, to, patch = {}) {
  const before = { stage: a.stage, next: a.next, due: a.due };
  const r = await save(a, { stage: to, ...patch });
  if (r.ok) toast(`${a.company} moved to ${STAGES()[to]}.`, false, { label: 'Undo', run: () => save(a, before) });
}

function go(view) {
  ui.view = view;
  render();
  $('view').focus({ preventScroll: true });
}

function openApp(id) {
  const a = appById(id);
  if (!a) return;
  ui.view = 'applications';
  ui.sel = id;
  if (ui.filter !== null && ui.filter !== a.stage) ui.filter = null;
  ui.q = '';
  render();
  document.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

// Turn an element into a drop target for files from Finder / Explorer.
function dropTarget(el, onPaths) {
  let depth = 0;
  el.addEventListener('dragenter', e => { e.preventDefault(); depth++; el.classList.add('drop'); });
  el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('drop'); } });
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    depth = 0; el.classList.remove('drop');
    const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
    if (paths.length) onPaths(paths);
  });
}
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());

async function addFiles(appId, kind, paths) {
  const r = await run(api.addFiles({ appId, kind, paths }));
  const n = r.ok ? r.result.length : 0;
  if (n) toast(`${n} file${n > 1 ? 's' : ''} stored${appId ? ' with ' + appById(appId).company : ' in your library'}.`);
}

/* ---------- render ---------- */
function render() {
  // Re-rendering replaces the DOM, so carry focus, caret and scroll positions across.
  const act = document.activeElement;
  const focusId = act && act.id;
  let caret = null;
  try { if (act && typeof act.selectionStart === 'number') caret = [act.selectionStart, act.selectionEnd]; } catch { /* not a text field */ }
  const scrolls = [...document.querySelectorAll('[data-scroll]')].map(e => [e.dataset.scroll, e.scrollTop]);

  renderSide();
  const v = $('view');
  v.className = 'view' + (ui.view === 'applications' && S.applications.length ? ' split' : '');
  v.replaceChildren();
  (VIEWS[ui.view] || VIEWS.dashboard)(v);

  for (const [k, top] of scrolls) { const e = document.querySelector(`[data-scroll="${k}"]`); if (e) e.scrollTop = top; }
  if (focusId) {
    const e = $(focusId);
    if (e && e !== document.activeElement) {
      e.focus({ preventScroll: true });
      try { if (caret) e.setSelectionRange(...caret); } catch { /* not a text field */ }
    }
  }
  saveUi();
}

function renderSide() {
  const active = S.applications.filter(isActive).length;
  const soon = S.applications.filter(a => isActive(a) && a.due && daysUntil(a.due) <= 7).length;
  const items = [
    ['dashboard', 'Dashboard', 'dashboard', '1', soon ? h('span', { class: 'badge', title: `${soon} deadline${soon > 1 ? 's' : ''} within a week` }, soon) : null],
    ['applications', 'Applications', 'briefcase', '2', active ? h('span', { class: 'count' }, active) : null],
    ['documents', 'Documents', 'file', '3', null],
  ];
  const navBtn = ([view, label, ic, key, extra]) => h('button', {
    class: 'nav', type: 'button', 'aria-current': ui.view === view ? 'page' : null, onclick: () => go(view),
    title: `${label} (${MOD}${key})`,
  }, icon(ic), h('span', { class: 'lbl' }, label), extra || h('kbd', null, MOD + key));
  $('nav').replaceChildren(...items.map(navBtn));
  $('sideFoot').replaceChildren(
    navBtn(['settings', 'Settings & backup', 'settings', ',', null]),
    h('p', { class: 'hint' }, 'Saved automatically on this computer.'),
  );
}

/* ---------- shared pieces ---------- */
function pipeline(onPick, current) {
  return h('div', { class: 'pipeline', role: 'group', 'aria-label': 'Filter by stage' },
    STAGES().map((s, i) => h('button', {
      class: 'stage', type: 'button', 'aria-pressed': String(current === i), onclick: () => onPick(i),
    }, h('span', { class: 'n' }, S.applications.filter(a => a.stage === i).length), h('span', { class: 'l' }, s))));
}

function sampleBar() {
  if (!S.applications.some(a => a.sample)) return null;
  return h('div', { class: 'sample-bar' },
    h('span', null, 'You’re looking at sample applications. Your own entries are kept when you clear them.'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => run(api.clearSample()) }, 'Clear sample data'));
}

function welcome(compact) {
  return h('section', { class: 'panel welcome' },
    h('h2', null, compact ? 'No applications yet' : 'Welcome — let’s set up your workspace'),
    compact ? null : h('p', { class: 'sub' }, 'Everything stays on this laptop: no account, no internet needed.'),
    h('ol', { class: 'steps' },
      h('li', null, h('b', null, 'Add your master CV'), h('span', null, 'Keep your base CV and cover letter in Documents. Copy them onto an application, then tailor the copy.')),
      h('li', null, h('b', null, 'Add each company'), h('span', null, 'One page per application with its deadline, next step and stage.')),
      h('li', null, h('b', null, 'Keep it all on that page'), h('span', null, 'The exact CV and cover letter you sent, plus research notes for the interview.'))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: openNew }, icon('plus'), 'Add your first application'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addFiles(null, 'cv') }, icon('upload'), 'Add master CV'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => run(api.loadSample()) }, 'Explore with sample data')));
}

function fileActions(f) {
  return [
    h('button', { class: 'icon-btn', type: 'button', title: isMac ? 'Show in Finder' : 'Show in folder', 'aria-label': `Show ${f.name} in folder`, onclick: () => run(api.revealFile(f.id), { quiet: true }) }, icon('folder')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Save a copy (e.g. to upload to a job portal)', 'aria-label': `Save a copy of ${f.name}`, onclick: () => run(api.exportFile(f.id), { quiet: true }) }, icon('download')),
    h('button', { class: 'icon-btn bad', type: 'button', title: 'Remove', 'aria-label': `Remove ${f.name}`, onclick: () => run(api.removeFile(f.id)) }, icon('trash')),
  ];
}
const openFileBtn = (f, extra) => h('button', { class: 'fname', type: 'button', title: 'Open', onclick: () => run(api.openFile(f.id), { quiet: true }) }, f.name, extra);

/* ---------- Dashboard ---------- */
function viewDashboard(v) {
  const hr = new Date().getHours();
  v.append(h('header', { class: 'view-head' },
    h('div', null,
      h('h1', null, hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'),
      h('p', { class: 'sub' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
    h('div', { class: 'tools' }, h('button', { class: 'btn', type: 'button', onclick: openNew }, icon('plus'), 'New application'))));

  if (!S.applications.length) { v.append(welcome(false)); return; }
  v.append(sampleBar() || '', pipeline(i => { ui.filter = i; ui.view = 'applications'; render(); }, null));

  const item = (a, right, detail) => h('li', null, h('button', { class: 'item', type: 'button', onclick: () => openApp(a.id) },
    h('span', { class: 't' }, a.company), h('span', { class: 'd' }, detail), h('span', { class: 'r' }, right)));
  const panel = (title, sub, items, emptyText) => h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, title), h('span', { class: 'count' }, sub)),
    items.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'empty' }, emptyText));

  const upcoming = S.applications.filter(a => isActive(a) && a.due && daysUntil(a.due) <= 30)
    .sort((x, y) => x.due.localeCompare(y.due));
  const attention = S.applications.filter(isActive).map(a => {
    const cv = filesFor(a.id, 'cv').length, notes = a.notes.trim().length;
    const reason = isInterview(a) && notes < 80 ? `${STAGES()[a.stage]} stage: research notes are thin`
      : !cv && a.stage === 0 ? 'No tailored CV yet'
      : !cv ? 'The CV you sent isn’t stored'
      : a.stage === 0 && !a.due ? 'No deadline set'
      : a.sponsor === 'Not checked' ? 'Visa sponsorship not checked'
      : null;
    return reason && [a, reason];
  }).filter(Boolean);
  const recent = [...S.applications].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, 6);

  v.append(h('div', { class: 'grid2' },
    panel('Coming up', 'Next 30 days', upcoming.map(a => item(a, dueChip(a), `${a.next || STAGES()[a.stage]} · ${a.role}`)),
      'No deadlines in the next 30 days. Set one from a company page.'),
    panel('Needs attention', attention.length ? `${attention.length} to sort` : '', attention.map(([a, why]) => item(a, h('span', { class: 'flag' }, 'Fix'), why)),
      'Nothing outstanding. Every active application has its documents and notes.'),
    panel('Recently updated', '', recent.map(a => item(a, stagePill(a), `${a.role || 'No role set'} · ${ago(a.updatedAt)}`)), '')));
}

/* ---------- Applications ---------- */
let listBody = null;

function visibleApps() {
  const q = ui.q.trim().toLowerCase();
  const list = S.applications.filter(a => (ui.filter === null || a.stage === ui.filter)
    && (!q || [a.company, a.role, a.location, a.notes, a.next].join(' ').toLowerCase().includes(q)));
  const sorters = {
    due: (x, y) => (isActive(y) - isActive(x)) || ((x.due ? daysUntil(x.due) : 1e4) - (y.due ? daysUntil(y.due) : 1e4)) || x.company.localeCompare(y.company),
    updated: (x, y) => y.updatedAt.localeCompare(x.updatedAt),
    company: (x, y) => x.company.localeCompare(y.company),
  };
  return list.sort(sorters[ui.sort] || sorters.due);
}

function viewApplications(v) {
  const total = S.applications.length;
  v.append(h('header', { class: 'view-head' },
    h('div', null, h('h1', null, 'Applications'),
      h('p', { class: 'sub' }, `${total} application${total === 1 ? '' : 's'} · ${S.applications.filter(isActive).length} active`)),
    h('div', { class: 'tools' },
      total ? h('label', { class: 'search' }, icon('search'),
        h('input', { id: 'appSearch', placeholder: 'Search companies, roles, notes…', value: ui.q, 'aria-label': 'Search applications',
          oninput: e => { ui.q = e.target.value; renderList(); },
          onkeydown: e => { if (e.key === 'Escape') { ui.q = ''; e.target.value = ''; renderList(); } } }),
        h('kbd', null, '/')) : null,
      h('button', { class: 'btn', type: 'button', onclick: openNew }, icon('plus'), 'New application'))));

  if (!total) { v.append(welcome(true)); return; }
  v.append(sampleBar() || '', pipeline(i => { ui.filter = ui.filter === i ? null : i; render(); }, ui.filter));

  listBody = h('div', { class: 'panel-body', 'data-scroll': 'list' });
  const listPanel = h('section', { class: 'panel', 'aria-label': 'Tracker' },
    h('div', { class: 'panel-head' }, h('span', { class: 'count', id: 'listCount' }),
      h('select', { class: 'sort', 'aria-label': 'Sort', value: ui.sort, onchange: e => { ui.sort = e.target.value; render(); } },
        h('option', { value: 'due' }, 'Sort: next deadline'), h('option', { value: 'updated' }, 'Sort: recently updated'), h('option', { value: 'company' }, 'Sort: company A–Z'))),
    listBody);
  const detailPanel = h('section', { class: 'panel', 'aria-label': 'Company page', id: 'detailPanel' });
  v.append(h('div', { class: 'main' }, listPanel, detailPanel));
  renderList();
  renderDetail(detailPanel);
}

function renderList() {
  if (!listBody) return;
  const list = visibleApps();
  const scope = ui.filter === null ? 'All' : STAGES()[ui.filter];
  $('listCount').textContent = `${scope} · ${list.length} application${list.length === 1 ? '' : 's'}${ui.q ? ` matching “${ui.q}”` : ''}`;
  if (!list.length) {
    listBody.replaceChildren(h('p', { class: 'empty' }, ui.q ? 'Nothing matches that search.' : 'No applications at this stage. Select the stage again to show all.'));
    return;
  }
  const ul = h('ul', { class: 'rows' });
  list.forEach((a, idx) => {
    const has = [[filesFor(a.id, 'cv').length, 'CV'], [filesFor(a.id, 'cover').length, 'Cover letter'], [a.notes.trim(), 'Notes']];
    ul.append(h('li', null, h('button', {
      class: 'row', type: 'button', id: `row-${a.id}`, 'aria-current': a.id === ui.sel ? 'true' : null,
      onclick: () => { ui.sel = a.id; render(); },
      onkeydown: e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const next = list[idx + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) { ui.sel = next.id; render(); $(`row-${next.id}`)?.focus(); $(`row-${next.id}`)?.scrollIntoView({ block: 'nearest' }); }
      },
    },
      h('div', null, h('div', { class: 'co' }, a.company), h('div', { class: 'role' }, a.role || 'No role set')),
      stagePill(a),
      h('div', { class: 'next' }, h('span', null, a.next), dueChip(a)),
      h('div', { class: 'hasrow' }, has.map(([on, n]) => h('span', { class: 'has' + (on ? ' on' : '') }, on ? `${n} ✓` : `No ${n === 'CV' ? n : n.toLowerCase()}`))))));
  });
  listBody.replaceChildren(ul);
}

function save(a, patch, opts) { return run(api.updateApp(a.id, patch), opts); }

function renderDetail(p) {
  const shown = visibleApps();
  let a = appById(ui.sel);
  if (!a || !shown.includes(a)) { a = shown[0] || appById(ui.sel) || S.applications[0]; ui.sel = a.id; renderList(); }
  const st = STAGES();

  const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
  const text = (key, attrs = {}) => h('input', { class: 'input', id: `f-${key}`, value: a[key] || '', autocomplete: 'off', ...attrs,
    onchange: e => save(a, { [key]: e.target.value.trim() }) });

  const actions = h('div', { class: 'actions' });
  if (a.url) actions.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => api.openLink(a.url), title: a.url }, 'Job posting', icon('external')));
  const offer = OFFER(), rejected = REJECTED();
  if (a.stage === rejected) {
    const before = [...a.history].reverse().find(x => x.stage !== rejected);
    const to = before ? before.stage : 1;
    actions.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => moveStage(a, to) }, icon('back'), `Reopen at ${st[to]}`));
  } else {
    if (a.stage > 0) {
      actions.append(h('button', { class: 'btn ghost', type: 'button', title: 'Move back one stage', onclick: () => moveStage(a, a.stage - 1) }, icon('back'), `Back to ${st[a.stage - 1]}`));
    }
    if (a.stage < offer) {
      const to = a.stage + 1;
      actions.append(
        h('button', { class: 'btn', type: 'button', onclick: () => moveStage(a, to, NEXT_ON_ARRIVAL[st[to]] ? { next: NEXT_ON_ARRIVAL[st[to]] } : {}) }, `Move to ${st[to]}`, icon('arrow')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => moveStage(a, rejected) }, 'Mark rejected'));
    }
  }

  const track = h('ol', { class: 'track' + (a.stage === rejected ? ' rej' : ''), 'aria-label': 'Stage' },
    st.slice(0, offer + 1).map((s, i) => h('li', { class: a.stage === rejected ? '' : i < a.stage ? 'done' : i === a.stage ? 'now' : '' },
      h('button', { type: 'button', title: `Set stage to ${s}`, 'aria-current': i === a.stage ? 'step' : null, onclick: () => { if (i !== a.stage) moveStage(a, i); } }, s))));

  const di = dueInfo(a);
  const nextbar = h('div', { class: 'nextbar' },
    field('Next step', text('next', { placeholder: 'e.g. Numerical test, video interview, submit form' })),
    field(di ? `Deadline · ${di.text}` : 'Deadline', h('input', { class: 'input', type: 'date', id: 'f-due', value: a.due || '', onchange: e => save(a, { due: e.target.value || null }) })));

  const lib = library();
  const docCol = kind => {
    const files = filesFor(a.id, kind);
    const col = h('div', { class: 'doc-col' + (files.length ? '' : ' missing') },
      h('div', { class: 'kind' }, KIND_TITLE[kind], files.length > 1 ? h('span', { class: 'count' }, `${files.length} versions`) : null),
      files.length ? files.map((f, i) => h('div', { class: 'file' }, icon('file'),
        openFileBtn(f, i === 0 && files.length > 1 ? h('span', { class: 'latest' }, 'latest') : null),
        h('span', { class: 'meta' }, `Added ${fmtWhen(f.addedAt)} · ${fmtSize(f.size)}`),
        h('span', { class: 'acts' }, fileActions(f)))) : h('p', { class: 'none' }, KIND_EMPTY[kind]),
      h('div', { class: 'doc-foot' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => addFiles(a.id, kind) }, icon('upload'), files.length ? 'Add version' : 'Add file'),
        kind !== 'other' && lib.length ? h('select', {
          'aria-label': `Copy a master document into ${KIND_TITLE[kind]}`, value: '',
          onchange: async e => { const id = e.target.value; if (!id) return; await run(api.copyFile({ fileId: id, appId: a.id, kind })); toast('Copied from your library. Open it to tailor this version.'); },
        }, h('option', { value: '' }, 'From library…'), lib.map(f => h('option', { value: f.id }, f.name))) : null));
    dropTarget(col, paths => addFiles(a.id, kind, paths));
    return col;
  };

  const savedNote = h('p', { class: 'saved', id: 'notesSaved' }, `Notes save as you type${a.notes ? ` · last edited ${ago(a.updatedAt)}` : ''}.`);
  let timer;
  const notes = h('textarea', {
    id: 'f-notes', value: a.notes, 'aria-label': `Research notes for ${a.company}`,
    placeholder: 'Company research, talking points, people you’ve met, questions to ask…',
    oninput: e => {
      clearTimeout(timer);
      savedNote.textContent = 'Saving…';
      const value = e.target.value;
      timer = setTimeout(async () => {
        const r = await save(a, { notes: value }, { quiet: true });
        if (r.ok) { savedNote.textContent = `Saved to ${a.company}.`; renderList(); renderSide(); }
      }, 400);
    },
  });
  const insertTemplate = () => {
    const v = notes.value.trimEnd();
    save(a, { notes: v ? `${v}\n\n${NOTES_TEMPLATE}` : NOTES_TEMPLATE });
  };

  const sponsorSel = h('select', { class: 'input', id: 'f-sponsor', value: a.sponsor, onchange: e => save(a, { sponsor: e.target.value }) },
    S.sponsorOptions.map(o => h('option', { value: o }, o)));
  const more = h('details', { class: 'block more', open: ui.moreOpen, ontoggle: e => { ui.moreOpen = e.target.open; saveUi(); } },
    h('summary', null, 'Company details'),
    h('div', { class: 'facts' },
      field('Location', text('location', { placeholder: 'City, office' })),
      field(a.sponsorCheckedAt ? `Visa sponsorship · checked ${fmtWhen(a.sponsorCheckedAt)}` : 'Visa sponsorship', sponsorSel),
      field('Salary', text('salary', { placeholder: 'e.g. £32,000 + bonus' })),
      field('Job link', text('url', { placeholder: 'https://…' }))));

  p.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', null, 'Company page'), stagePill(a)),
    h('div', { class: 'panel-body', 'data-scroll': `detail-${a.id}` }, h('div', { class: 'detail' },
      h('div', { class: 'dhead' },
        h('div', { style: 'flex:1;min-width:220px' },
          h('input', { class: 'title-input', id: 'f-company', value: a.company, 'aria-label': 'Company', autocomplete: 'off',
            onchange: e => { if (e.target.value.trim()) save(a, { company: e.target.value.trim() }); else { e.target.value = a.company; toast('A company name is needed.', true); } } }),
          h('input', { class: 'role-input', id: 'f-role', value: a.role, placeholder: 'Add the role', 'aria-label': 'Role', autocomplete: 'off',
            onchange: e => save(a, { role: e.target.value.trim() }) })),
        actions),
      track,
      nextbar,
      h('section', { class: 'block' },
        h('div', { class: 'block-head' }, h('div', null, h('h4', null, `Documents for ${a.company}`),
          h('p', { class: 'hint' }, 'The exact versions you sent. Drop files onto a column, or use Add. The app keeps its own copy, so moving the original won’t break anything.'))),
        h('div', { class: 'docs' }, docCol('cv'), docCol('cover'), docCol('other'))),
      h('section', { class: 'block notes' },
        h('div', { class: 'block-head' }, h('div', null, h('h4', null, 'Research notes'), h('p', { class: 'hint' }, `Your own research on ${a.company}, ready to revise when the interview comes.`)),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: insertTemplate }, 'Insert research template')),
        notes, savedNote),
      more,
      h('div', { class: 'danger-zone' },
        h('span', null, `Added ${fmtWhen(a.createdAt)} · updated ${ago(a.updatedAt)}`),
        h('button', { class: 'btn sm danger', type: 'button', onclick: () => run(api.deleteApp(a.id)) }, icon('trash'), 'Delete application')))));
}

/* ---------- Documents ---------- */
function viewDocuments(v) {
  v.append(h('header', { class: 'view-head' },
    h('div', null, h('h1', null, 'Documents'), h('p', { class: 'sub' }, 'Master versions to start from, and every version you’ve sent.')),
    h('div', { class: 'tools' },
      h('label', { class: 'search' }, icon('search'), h('input', { id: 'docSearch', placeholder: 'Search file names…', value: ui.docQ, 'aria-label': 'Search documents',
        oninput: e => { ui.docQ = e.target.value; render(); } })),
      h('button', { class: 'btn', type: 'button', onclick: () => addFiles(null, 'cv') }, icon('upload'), 'Add master document'))));

  const q = ui.docQ.trim().toLowerCase();
  const match = f => !q || f.name.toLowerCase().includes(q) || (f.appId && appById(f.appId)?.company.toLowerCase().includes(q));
  const active = S.applications.filter(isActive);

  const lib = library().filter(match);
  const drop = h('div', { class: 'droparea' }, 'Drop your base CV, cover letter or transcript here to add it to the library.');
  dropTarget(drop, paths => addFiles(null, 'cv', paths));
  v.append(h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Master documents'),
      h('p', { class: 'sub', style: 'font-size:13px' }, 'Copy one onto an application, then tailor the copy. The master stays untouched.')),
      h('span', { class: 'count' }, `${library().length} file${library().length === 1 ? '' : 's'}`)),
    lib.length ? h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'File'), h('th', null, 'Type'), h('th', null, 'Added'), h('th', null, 'Use for an application'), h('th', { class: 'right' }, ''))),
      h('tbody', null, lib.map(f => h('tr', null,
        h('td', null, openFileBtn(f)),
        h('td', null, h('select', { class: 'kindsel', value: f.kind, 'aria-label': 'Document type', onchange: e => run(api.updateFile(f.id, { kind: e.target.value })) },
          Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k }, l)))),
        h('td', { class: 'due' }, fmtWhen(f.addedAt)),
        h('td', null, active.length ? h('select', { class: 'kindsel', value: '', 'aria-label': `Copy ${f.name} to an application`,
          onchange: async e => {
            const appId = e.target.value; if (!appId) return;
            const r = await run(api.copyFile({ fileId: f.id, appId }));
            if (r.ok) toast(`Copied to ${appById(appId).company}.`);
          } }, h('option', { value: '' }, 'Copy to…'), active.map(a => h('option', { value: a.id }, a.company))) : h('span', { class: 'due' }, 'Add an application first')),
        h('td', { class: 'right' }, fileActions(f)))))) : null,
    drop));

  const kinds = [['all', 'All'], ['cv', 'CVs'], ['cover', 'Cover letters'], ['other', 'Other']];
  const sent = S.files.filter(f => f.appId && (ui.docKind === 'all' || f.kind === ui.docKind) && match(f))
    .sort((x, y) => y.addedAt.localeCompare(x.addedAt));
  v.append(h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Sent with applications'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by type' }, kinds.map(([k, l]) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(ui.docKind === k), onclick: () => { ui.docKind = k; render(); } }, l)))),
    sent.length ? h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'File'), h('th', null, 'Type'), h('th', null, 'Company'), h('th', null, 'Added'), h('th', { class: 'right' }, ''))),
      h('tbody', null, sent.map(f => {
        const a = appById(f.appId);
        return h('tr', null,
          h('td', null, openFileBtn(f)),
          h('td', null, KIND_LABEL[f.kind]),
          h('td', null, h('button', { class: 'linkish', type: 'button', onclick: () => openApp(a.id) }, a.company), ' ', stagePill(a)),
          h('td', { class: 'due' }, fmtWhen(f.addedAt)),
          h('td', { class: 'right' }, fileActions(f)));
      }))) : h('p', { class: 'empty' }, q || ui.docKind !== 'all' ? 'No documents match.' : 'Files you add on a company page appear here.')));
}

/* ---------- Settings ---------- */
function viewSettings(v) {
  const theme = (() => { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } })();
  const setting = (title, desc, control) => h('div', { class: 'setting' }, h('div', null, h('b', null, title), h('p', null, desc)), control);
  const hasSample = S.applications.some(a => a.sample);
  const keys = [[`${MOD}K`, 'Quick find: jump to any company, file or action'], [`${MOD}N`, 'New application'],
    [`${MOD}1  ${MOD}2  ${MOD}3`, 'Dashboard, Applications, Documents'], [`${MOD},`, 'Settings & backup'],
    ['/', 'Search applications'], ['↑ ↓', 'Move through the application list']];

  v.append(h('header', { class: 'view-head' }, h('div', null, h('h1', null, 'Settings & backup'), h('p', { class: 'sub' }, 'Your data never leaves this computer unless you back it up somewhere.'))));
  v.append(h('div', { class: 'settings' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Your data')),
      setting('Where it lives', h('span', null, 'Tracker and files are stored in ', h('span', { class: 'path' }, S.dataPath)),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => api.openDataFolder() }, icon('folder'), 'Show folder')),
      setting('Back up', 'Copies everything (tracker and every file) into a folder you choose: a USB stick, or a OneDrive, Google Drive or iCloud folder. Do this every week or so.',
        h('button', { class: 'btn', type: 'button', onclick: backup }, icon('archive'), 'Back up now…')),
      setting('Restore from a backup', 'Use this on a new laptop, or to roll back. Your current workspace is kept aside first.',
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
          const r = await run(api.restore());
          if (r.ok && r.result) toast('Backup restored. Your previous workspace was kept beside the data folder.');
        } }, 'Restore…'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Appearance and sample data')),
      setting('Theme', 'Follow your computer, or pick one.',
        h('select', { class: 'input', style: 'width:auto', value: theme, onchange: e => applyTheme(e.target.value) },
          h('option', { value: 'system' }, 'Match system'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'))),
      setting('Sample applications', hasSample ? 'Sample applications are loaded. Clearing them keeps everything you added.' : 'Load a few invented applications to see how the workspace fits together.',
        hasSample ? h('button', { class: 'btn ghost', type: 'button', onclick: () => run(api.clearSample()) }, 'Clear sample data')
          : h('button', { class: 'btn ghost', type: 'button', onclick: () => run(api.loadSample()) }, 'Load sample data'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Keyboard shortcuts')),
      h('dl', { class: 'keys' }, keys.flatMap(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)])))));
}

function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* storage unavailable */ }
}

async function backup() {
  const r = await run(api.backup(), { quiet: true });
  if (r.ok && r.result) toast('Backup saved.');
}

const VIEWS = { dashboard: viewDashboard, applications: viewApplications, documents: viewDocuments, settings: viewSettings };

/* ---------- New application ---------- */
function openNew() {
  for (const id of ['nCompany', 'nRole', 'nDue', 'nUrl']) $(id).value = '';
  $('newDialog').showModal();
  $('nCompany').focus();
}
$('newCancel').addEventListener('click', () => $('newDialog').close());
$('newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const company = $('nCompany').value.trim();
  if (!company) return;
  const r = await run(api.createApp({ company, role: $('nRole').value.trim() }), { quiet: true });
  if (!r.ok) return;
  const patch = {};
  if ($('nDue').value) Object.assign(patch, { due: $('nDue').value, next: 'Application closes' });
  if ($('nUrl').value.trim()) patch.url = $('nUrl').value.trim();
  if (Object.keys(patch).length) await run(api.updateApp(r.result, patch), { quiet: true });
  $('newDialog').close();
  ui.filter = null;
  openApp(r.result);
  toast(`${company} added. Next: store the CV you’ll send.`);
});

/* ---------- Quick find ---------- */
const pal = { idx: 0, items: [] };
function paletteItems(q) {
  q = q.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const hit = s => terms.every(t => s.toLowerCase().includes(t));
  const out = [];
  const commands = [
    { grp: 'Action', t: 'New application', icon: 'plus', run: openNew },
    { grp: 'Go to', t: 'Dashboard', icon: 'dashboard', run: () => go('dashboard') },
    { grp: 'Go to', t: 'Applications', icon: 'briefcase', run: () => go('applications') },
    { grp: 'Go to', t: 'Documents', icon: 'file', run: () => go('documents') },
    { grp: 'Action', t: 'Add master document', icon: 'upload', run: () => addFiles(null, 'cv') },
    { grp: 'Action', t: 'Back up workspace', icon: 'archive', run: backup },
    { grp: 'Go to', t: 'Settings & backup', icon: 'settings', run: () => go('settings') },
  ];
  const apps = [...S.applications].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  for (const a of apps) {
    const base = `${a.company} ${a.role} ${a.location} ${STAGES()[a.stage]}`;
    if (!q || hit(base)) out.push({ grp: 'Application', t: a.company, d: `${a.role || 'No role'} · ${STAGES()[a.stage]}`, icon: 'briefcase', run: () => openApp(a.id) });
    else if (hit(a.notes)) out.push({ grp: 'In notes', t: a.company, d: 'Matches your research notes', icon: 'briefcase', run: () => openApp(a.id) });
  }
  if (q) {
    for (const f of S.files) {
      const owner = f.appId ? appById(f.appId)?.company : 'Library';
      if (hit(`${f.name} ${owner}`)) out.push({ grp: 'Open file', t: f.name, d: owner, icon: 'file', run: () => run(api.openFile(f.id), { quiet: true }) });
    }
  }
  const cmds = commands.filter(c => !q || hit(`${c.grp} ${c.t}`));
  return (q ? [...out, ...cmds] : [...out.slice(0, 6), ...cmds]).slice(0, 40);
}
function renderPalette() {
  pal.items = paletteItems($('paletteInput').value);
  pal.idx = Math.min(pal.idx, Math.max(0, pal.items.length - 1));
  $('paletteResults').replaceChildren(...(pal.items.length ? pal.items.map((it, i) => h('li', null, h('button', {
    class: 'result', type: 'button', role: 'option', 'aria-selected': String(i === pal.idx), id: `res-${i}`,
    onmousemove: () => { if (pal.idx !== i) { pal.idx = i; renderPalette(); } },
    onclick: () => choose(i),
  }, icon(it.icon), h('span', { class: 't' }, it.t, it.d ? h('span', { class: 'd' }, ` · ${it.d}`) : null), h('span', { class: 'grp' }, it.grp))))
    : [h('li', { class: 'empty' }, 'No matches.')]));
  $(`res-${pal.idx}`)?.scrollIntoView({ block: 'nearest' });
}
function choose(i) {
  const it = pal.items[i];
  if (!it) return;
  $('palette').close();
  it.run();
}
function openPalette() {
  if ($('newDialog').open) return;
  $('paletteInput').value = '';
  pal.idx = 0;
  renderPalette();
  if (!$('palette').open) $('palette').showModal();
  $('paletteInput').focus();
}
$('paletteInput').addEventListener('input', () => { pal.idx = 0; renderPalette(); });
$('paletteInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = pal.items.length;
    if (n) pal.idx = (pal.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderPalette();
  } else if (e.key === 'Enter') { e.preventDefault(); choose(pal.idx); }
});
$('palette').addEventListener('click', e => { if (e.target === $('palette')) $('palette').close(); });

/* ---------- keyboard + menu commands ---------- */
function command(cmd) {
  if (cmd.startsWith('view:')) { for (const d of document.querySelectorAll('dialog[open]')) d.close(); go(cmd.slice(5)); return; }
  if (cmd === 'find') openPalette();
  else if (cmd === 'new') openNew();
  else if (cmd === 'backup') backup();
  else if (cmd === 'library-add') addFiles(null, 'cv');
}
api.onCommand(command);
document.addEventListener('keydown', e => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !typing && ui.view === 'applications' && $('appSearch')) { e.preventDefault(); $('appSearch').focus(); }
});

/* ---------- start ---------- */
$('findBtn').append(icon('search'), h('span', null, 'Quick find'), h('kbd', null, `${MOD}K`));
$('findBtn').addEventListener('click', openPalette);
$('newBtn').append(icon('plus'), 'New application');
$('newBtn').addEventListener('click', openNew);
if (isMac) document.body.classList.add('mac');
try { const t = localStorage.getItem('theme'); if (t && t !== 'system') applyTheme(t); } catch { /* storage unavailable */ }

api.state().then(r => { S = r.state; render(); });
