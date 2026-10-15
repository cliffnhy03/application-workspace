const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, STAGES, OFFER, REJECTED } = require('../src/store');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')); }
function sourceFile(dir, name, body = 'hello') { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; }

test('creates, edits and persists an application', () => {
  const root = tmp();
  const s = new Store(root);
  const id = s.createApplication({ company: 'Acme', role: 'Analyst' });
  s.updateApplication(id, { stage: 2, due: '2026-11-01', notes: 'Prep', bogus: 'ignored' });
  const again = new Store(root).snapshot();
  const a = again.applications[0];
  assert.equal(a.company, 'Acme');
  assert.equal(a.stage, 2);
  assert.equal(a.due, '2026-11-01');
  assert.equal(a.bogus, undefined);
  assert.deepEqual(a.history.map(h => h.stage), [0, 2]);
});

test('rejecting clears the deadline and rejects bad input', () => {
  const s = new Store(tmp());
  const id = s.createApplication({ company: 'Acme' });
  s.updateApplication(id, { due: '2026-11-01' });
  s.updateApplication(id, { stage: 6 });
  assert.equal(s.snapshot().applications[0].due, null);
  assert.throws(() => s.updateApplication(id, { stage: 9 }));
  assert.throws(() => s.updateApplication(id, { company: '  ' }));
  assert.throws(() => s.createApplication({ company: '' }));
});

test('stores a private copy of files and removes them with the application', () => {
  const root = tmp(), src = tmp();
  const s = new Store(root);
  const id = s.createApplication({ company: 'Acme' });
  const fid = s.addFile({ appId: id, kind: 'cv', sourcePath: sourceFile(src, 'My CV.pdf', 'cv-v1') });
  const stored = s.filePath(fid);
  fs.rmSync(path.join(src, 'My CV.pdf'));
  assert.equal(fs.readFileSync(stored, 'utf8'), 'cv-v1');
  assert.equal(s.snapshot().files[0].name, 'My CV.pdf');
  s.deleteApplication(id);
  assert.equal(fs.existsSync(stored), false);
  assert.equal(s.snapshot().files.length, 0);
});

test('library documents can be copied onto an application', () => {
  const s = new Store(tmp());
  const id = s.createApplication({ company: 'Acme' });
  const master = s.addFile({ kind: 'cv', sourcePath: sourceFile(tmp(), 'Master CV.docx', 'master') });
  const copy = s.copyFile(master, id);
  const f = s.snapshot().files.find(x => x.id === copy);
  assert.equal(f.appId, id);
  assert.equal(f.kind, 'cv');
  assert.notEqual(s.filePath(copy), s.filePath(master));
  assert.equal(fs.readFileSync(s.filePath(copy), 'utf8'), 'master');
});

test('a corrupt data file is kept aside, not overwritten', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'workspace.json'), '{not json');
  const s = new Store(root);
  assert.equal(s.snapshot().applications.length, 0);
  assert.ok(fs.readdirSync(root).some(n => n.startsWith('workspace-unreadable-')));
});

test('backup and restore round-trip', () => {
  const root = tmp(), out = tmp();
  const s = new Store(root);
  const id = s.createApplication({ company: 'Kept' });
  s.addFile({ appId: id, kind: 'cover', sourcePath: sourceFile(tmp(), 'CL.pdf') });
  const backup = s.backupTo(out);
  s.deleteApplication(id);
  s.createApplication({ company: 'Later' });
  s.restoreFrom(backup);
  const snap = s.snapshot();
  assert.deepEqual(snap.applications.map(a => a.company), ['Kept']);
  assert.ok(fs.existsSync(s.filePath(snap.files[0].id)));
  assert.throws(() => s.restoreFrom(tmp()), /not an Application Workspace backup/);
});

test('sample data loads and clears without touching real entries', () => {
  const s = new Store(tmp());
  s.createApplication({ company: 'Mine' });
  s.loadSample();
  assert.ok(s.snapshot().applications.length > 5);
  s.clearSample();
  assert.deepEqual(s.snapshot().applications.map(a => a.company), ['Mine']);
});

test('imports applications once, skipping duplicates and blanks', () => {
  const s = new Store(tmp());
  const rows = [
    { company: 'Bain', role: 'Associate consultant', stage: 1, createdAt: '2026-09-12T00:00:00.000Z', history: [{ stage: 0, at: '2026-09-12T00:00:00.000Z' }, { stage: 1, at: '2026-09-12T00:00:00.000Z' }] },
    { company: 'Newton', role: 'Graduate consultant', stage: 3, due: 'not a date', notes: 'VI notes' },
    { company: '  ', role: 'nobody' },
  ];
  assert.deepEqual(s.importApplications(rows), { added: 2, skipped: 1 });
  assert.deepEqual(s.importApplications(rows), { added: 0, skipped: 3 });
  const [bain, newton] = s.snapshot().applications;
  assert.equal(bain.createdAt, '2026-09-12T00:00:00.000Z');
  assert.equal(bain.history.length, 2);
  assert.equal(newton.stage, 3);
  assert.equal(newton.due, null);
});

test('stages include video interview before interview', () => {
  assert.deepEqual(STAGES.slice(2, 5), ['Online test', 'Video interview', 'Interview']);
});

test('stepping back undoes a misclick, including a rejection', () => {
  const s = new Store(tmp());
  const id = s.createApplication({ company: 'Acme' });
  s.updateApplication(id, { stage: 1 });
  s.updateApplication(id, { stage: 2, next: 'Numerical test', due: '2026-11-01' });
  s.updateApplication(id, { stage: 3 });
  s.updateApplication(id, { stage: 2 });
  let a = s.snapshot().applications[0];
  assert.equal(a.stage, 2);
  assert.deepEqual(a.history.map(h => h.stage), [0, 1, 2]);
  s.updateApplication(id, { stage: REJECTED });
  assert.equal(s.snapshot().applications[0].due, null);
  s.updateApplication(id, { stage: 2 });
  a = s.snapshot().applications[0];
  assert.equal(a.next, 'Numerical test');
  assert.equal(a.due, '2026-11-01');
  assert.deepEqual(a.history.map(h => h.stage), [0, 1, 2]);
  s.updateApplication(id, { stage: OFFER });
  assert.equal(s.snapshot().applications[0].next, 'Offer received');
});

test('version 1 data moves onto the new stages, with a backup kept', () => {
  const root = tmp();
  const v1 = { version: 1, files: [], applications: [
    { id: 'a', company: 'Old interview', stage: 3, history: [{ stage: 0, at: 'x' }, { stage: 3, at: 'y' }] },
    { id: 'b', company: 'Old offer', stage: 4, history: [] },
    { id: 'c', company: 'Old rejected', stage: 5, history: [] },
    { id: 'd', company: 'Old test', stage: 2, history: [] },
  ] };
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify(v1));
  const apps = new Store(root).snapshot().applications;
  assert.deepEqual(apps.map(a => STAGES[a.stage]), ['Interview', 'Offer', 'Rejected', 'Online test']);
  assert.deepEqual(apps[0].history.map(h => h.stage), [0, 4]);
  assert.ok(fs.existsSync(path.join(root, 'workspace-v1-backup.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')).version, 2);
  assert.equal(new Store(root).snapshot().applications[0].stage, 4);
});
