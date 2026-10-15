const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Store } = require('./store');

// Release check, run by CI on fresh machines: AW_SMOKE_TEST=<result file> starts the app on
// throwaway data, exercises it, writes "ok …" or "fail …" to that file and quits.
const smokeFile = process.env.AW_SMOKE_TEST;
if (smokeFile) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aw-smoke-')));

let win, store;
const isMac = process.platform === 'darwin';
const DOC_FILTERS = [
  { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'pages', 'odt', 'rtf', 'txt', 'md', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg'] },
  { name: 'All files', extensions: ['*'] },
];

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function trash(p) {
  shell.trashItem(p).catch(() => fs.rmSync(p, { force: true, recursive: true }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 940, minHeight: 600,
    title: 'Application Workspace',
    backgroundColor: '#f1f4f3',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Links open in the user's browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (smokeFile) smokeTest();
}

function smokeTest() {
  const errors = [];
  const finish = (ok, detail) => {
    fs.writeFileSync(smokeFile, `${ok ? 'ok' : 'fail'} ${app.getVersion()} ${process.platform}-${process.arch}: ${detail}\n`);
    app.exit(ok ? 0 : 1);
  };
  const timer = setTimeout(() => finish(false, 'timed out after 60s'), 60000);
  win.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const out = await win.webContents.executeJavaScript(`(async () => {
        await new Promise(r => { const t = setInterval(() => { if (document.querySelector('#nav .nav')) { clearInterval(t); r(); } }, 50); });
        const c = await api.createApp({ company: 'Smoke Test Ltd', role: 'Analyst' });
        if (!c.ok) throw new Error(c.error);
        const u = await api.updateApp(c.result, { stage: 3 });
        if (!u.ok) throw new Error(u.error);
        const s = u.state;
        return 'stage ' + s.stages[s.applications[0].stage] + ', ' + document.querySelectorAll('#nav .nav').length + ' nav items';
      })()`);
      clearTimeout(timer);
      if (errors.length) finish(false, 'console errors: ' + errors.join(' | '));
      else finish(true, out);
    } catch (err) {
      clearTimeout(timer);
      finish(false, err.message);
    }
  });
}

function openExternal(url) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* not a link */ }
}

const send = cmd => win && win.webContents.send('command', cmd);

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Application…', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
      { label: 'Add Master Document…', click: () => send('library-add') },
      { type: 'separator' },
      { label: 'Back Up Workspace…', click: () => send('backup') },
      { label: 'Show Data Folder', click: () => shell.openPath(store.root) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'Go', submenu: [
      { label: 'Quick Find…', accelerator: 'CmdOrCtrl+K', click: () => send('find') },
      { type: 'separator' },
      { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => send('view:dashboard') },
      { label: 'Applications', accelerator: 'CmdOrCtrl+2', click: () => send('view:applications') },
      { label: 'Documents', accelerator: 'CmdOrCtrl+3', click: () => send('view:documents') },
      { label: 'Settings & Backup', accelerator: 'CmdOrCtrl+,', click: () => send('view:settings') },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Every handler returns the fresh workspace so the window can re-render from one source of truth.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, result, state: store.snapshot() };
    } catch (err) {
      return { ok: false, error: err.message, state: store.snapshot() };
    }
  });
}

async function pickFiles(title) {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters: DOC_FILTERS });
  return r.canceled ? [] : r.filePaths;
}

async function confirm(message, detail, ok) {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [ok, 'Cancel'], defaultId: 1, cancelId: 1, message, detail });
  return r.response === 0;
}

function registerHandlers() {
  handle('state', () => null);
  handle('app:create', fields => store.createApplication(fields));
  handle('app:update', (id, patch) => store.updateApplication(id, patch));
  handle('app:delete', async id => {
    const a = store.snapshot().applications.find(x => x.id === id);
    if (!a) return false;
    const n = store.snapshot().files.filter(f => f.appId === id).length;
    const ok = await confirm(`Delete ${a.company}?`,
      `The application, its notes${n ? ` and its ${n} stored file${n > 1 ? 's' : ''}` : ''} will be removed. Files go to your ${isMac ? 'Bin' : 'Recycle Bin'}.`, 'Delete');
    if (ok) store.deleteApplication(id);
    return ok;
  });
  handle('file:add', async ({ appId, kind, paths }) => {
    const list = paths && paths.length ? paths : await pickFiles(kind === 'cv' ? 'Choose a CV' : kind === 'cover' ? 'Choose a cover letter' : 'Choose files');
    return list.map(p => store.addFile({ appId, kind, sourcePath: p }));
  });
  handle('file:copy', ({ fileId, appId, kind }) => store.copyFile(fileId, appId, kind));
  handle('file:update', (fileId, patch) => store.updateFile(fileId, patch));
  handle('file:remove', async fileId => {
    const f = store.snapshot().files.find(x => x.id === fileId);
    if (!f) return false;
    const ok = await confirm(`Remove “${f.name}”?`, `The stored copy goes to your ${isMac ? 'Bin' : 'Recycle Bin'}. Your original file is not affected.`, 'Remove');
    if (ok) store.removeFile(fileId);
    return ok;
  });
  handle('file:open', async fileId => {
    const err = await shell.openPath(store.filePath(fileId));
    if (err) throw new Error(err);
  });
  handle('file:reveal', fileId => shell.showItemInFolder(store.filePath(fileId)));
  handle('file:export', async fileId => {
    const f = store.snapshot().files.find(x => x.id === fileId);
    const r = await dialog.showSaveDialog(win, { title: 'Save a copy', defaultPath: path.join(app.getPath('downloads'), f.name) });
    if (r.canceled) return null;
    fs.copyFileSync(store.filePath(fileId), r.filePath);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });
  handle('link:open', url => openExternal(url));
  handle('data:open', () => shell.openPath(store.root));
  handle('data:backup', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to save the backup', buttonLabel: 'Save Backup Here', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    const dest = store.backupTo(r.filePaths[0]);
    shell.showItemInFolder(dest);
    return dest;
  });
  handle('data:restore', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a backup folder', buttonLabel: 'Restore', properties: ['openDirectory'] });
    if (r.canceled) return null;
    const ok = await confirm('Replace everything with this backup?', 'Your current workspace is kept as a separate folder beside the data folder, so nothing is lost.', 'Restore');
    return ok ? store.restoreFrom(r.filePaths[0]) : null;
  });
  handle('sample:load', () => store.loadSample());
  handle('sample:clear', () => store.clearSample());
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'workspace'), { trash });
  registerHandlers();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
