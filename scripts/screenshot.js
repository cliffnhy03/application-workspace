// Drives the real app against a throwaway data folder and saves a screenshot of each view.
// Usage: npx electron scripts/screenshot.js <output-dir>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const out = path.resolve(process.argv[2] || 'screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-shots-'));
app.setPath('userData', path.join(tmp, 'userdata'));
fs.mkdirSync(out, { recursive: true });
for (const n of ['CV_Northbank_Markets_v2.pdf', 'CoverLetter_Northbank.pdf', 'Master_CV_2026.docx', 'Master_CoverLetter.docx']) {
  fs.writeFileSync(path.join(tmp, n), 'placeholder');
}

require('../src/main.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  try {
    await wait(1500);
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
    win.setSize(1320, 860);
    // A background window paints lazily, which would capture stale frames.
    win.webContents.setBackgroundThrottling(false);
    const js = code => win.webContents.executeJavaScript(code);
    const shot = async name => {
      await wait(400);
      await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };

    await shot('01-welcome');
    await js(`(async () => {
      await api.loadSample();
      const s = (await api.state()).state;
      const nb = s.applications.find(a => a.company === 'Northbank Capital');
      await api.addFiles({ appId: nb.id, kind: 'cv', paths: [${JSON.stringify(path.join(tmp, 'CV_Northbank_Markets_v2.pdf'))}] });
      await api.addFiles({ appId: nb.id, kind: 'cover', paths: [${JSON.stringify(path.join(tmp, 'CoverLetter_Northbank.pdf'))}] });
      await api.addFiles({ appId: null, kind: 'cv', paths: [${JSON.stringify(path.join(tmp, 'Master_CV_2026.docx'))}] });
      await api.addFiles({ appId: null, kind: 'cover', paths: [${JSON.stringify(path.join(tmp, 'Master_CoverLetter.docx'))}] });
      const r = await api.state(); S = r.state; ui.view = 'dashboard'; render();
    })()`);
    await shot('02-dashboard');
    await js(`applyTheme('light')`);
    await js(`openApp(S.applications.find(a => a.company === 'Northbank Capital').id)`);
    await shot('03-applications');
    await js(`[...document.querySelectorAll('.actions .btn')].find(b => b.textContent.startsWith('Move to')).click()`);
    await shot('03b-moved-with-undo');
    await js(`document.querySelector('.toast-action').click()`);
    await shot('03c-after-undo');
    await js(`document.querySelector('[data-scroll^="detail"]').scrollTop = 600`);
    await shot('04-company-page-lower');
    await js(`go('documents')`);
    await shot('05-documents');
    await js(`go('settings')`);
    await shot('06-settings');
    await js(`go('applications'); openPalette(); document.getElementById('paletteInput').value = 'north'; document.getElementById('paletteInput').dispatchEvent(new Event('input'))`);
    await shot('07-quick-find');
    await js(`document.getElementById('palette').close(); openNew(); document.getElementById('nCompany').value='Acme Strategy'`);
    await shot('08-new-application');
    await js(`document.getElementById('newDialog').close(); applyTheme('dark'); go('applications')`);
    await shot('09-dark');

    // Check the data actually landed on disk.
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'userdata', 'workspace', 'workspace.json'), 'utf8'));
    console.log(JSON.stringify({ applications: saved.applications.length, files: saved.files.length, errors }));
    app.exit(0);
  } catch (err) {
    console.error('Screenshot run failed:', err);
    app.exit(1);
  }
});
