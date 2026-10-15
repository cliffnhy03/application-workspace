// Local storage for the workspace: one JSON file for the tracker data, and a
// files/ folder holding a private copy of every CV, cover letter and document.
// Deliberately free of Electron imports so it can be tested with plain Node.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STAGES = ['Shortlisted', 'Applied', 'Online test', 'Video interview', 'Interview', 'Offer', 'Rejected'];
const OFFER = STAGES.indexOf('Offer');
const REJECTED = STAGES.indexOf('Rejected');
const KINDS = ['cv', 'cover', 'other'];
const SPONSOR = ['Not checked', 'On the sponsor register', 'Not on the register', 'Not needed'];
const EDITABLE = ['company', 'role', 'stage', 'location', 'sponsor', 'url', 'next', 'due', 'notes', 'salary'];
const SCHEMA_VERSION = 2;

// Version 1 had no Video interview stage: everything from Interview onwards moves up one.
function migrateV1(a) {
  const shift = s => (s >= 3 ? s + 1 : s);
  return { ...a, stage: shift(a.stage), history: (a.history || []).map(h => ({ ...h, stage: shift(h.stage) })) };
}

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID().slice(0, 8);

function safeName(name) {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^\w.\- ()&]+/g, '_').slice(-120) || 'file';
}

function blankApplication(fields) {
  const t = now();
  return {
    id: newId(), company: '', role: '', stage: 0, location: '', sponsor: SPONSOR[0], sponsorCheckedAt: null,
    url: '', salary: '', next: 'Prepare application', due: null, notes: '', sample: false, reopen: null,
    createdAt: t, updatedAt: t, history: [{ stage: 0, at: t }], ...fields,
  };
}

class Store {
  constructor(root, { trash } = {}) {
    this.root = root;
    this.dataFile = path.join(root, 'workspace.json');
    this.filesDir = path.join(root, 'files');
    // Removing a file goes through `trash` so the app can send it to the OS bin instead of erasing it.
    this.trash = trash || (p => fs.rmSync(p, { force: true, recursive: true }));
    this.data = this.#load();
    if (this.migrated) this.#save();
  }

  #load() {
    fs.mkdirSync(this.filesDir, { recursive: true });
    if (!fs.existsSync(this.dataFile)) return { version: SCHEMA_VERSION, applications: [], files: [] };
    try {
      const d = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      let apps = d.applications || [];
      if ((d.version || 1) < 2) {
        fs.copyFileSync(this.dataFile, this.dataFile.replace(/\.json$/, '-v1-backup.json'));
        apps = apps.map(migrateV1);
        this.migrated = true;
      }
      return {
        version: SCHEMA_VERSION,
        applications: apps.map(a => blankApplication(a)),
        files: d.files || [],
      };
    } catch (err) {
      // Never silently lose someone's tracker: keep the unreadable file beside a fresh one.
      const keep = this.dataFile.replace(/\.json$/, `-unreadable-${Date.now()}.json`);
      fs.renameSync(this.dataFile, keep);
      return { version: SCHEMA_VERSION, applications: [], files: [], recoveredFrom: keep };
    }
  }

  #save() {
    const tmp = this.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.dataFile);
  }

  #app(id) {
    const a = this.data.applications.find(x => x.id === id);
    if (!a) throw new Error('Application not found');
    return a;
  }

  #file(id) {
    const f = this.data.files.find(x => x.id === id);
    if (!f) throw new Error('File not found');
    return f;
  }

  snapshot() {
    return { stages: STAGES, sponsorOptions: SPONSOR, dataPath: this.root, ...structuredClone(this.data) };
  }

  createApplication({ company, role }) {
    company = String(company || '').trim();
    role = String(role || '').trim();
    if (!company) throw new Error('Company is required');
    const a = blankApplication({ company, role });
    this.data.applications.push(a);
    this.#save();
    return a.id;
  }

  // Bulk-add applications from another tracker. Entries whose company + role already exist are skipped,
  // so running the same import twice doesn't create duplicates.
  importApplications(items) {
    const key = a => `${a.company}|${a.role}`.trim().toLowerCase().replace(/\s+/g, ' ');
    const seen = new Set(this.data.applications.map(key));
    let added = 0, skipped = 0;
    for (const it of items) {
      const company = String(it.company || '').trim();
      if (!company) { skipped++; continue; }
      const fields = { company, role: String(it.role || '').trim() };
      if (seen.has(key(fields))) { skipped++; continue; }
      const stage = Number.isInteger(it.stage) && it.stage >= 0 && it.stage < STAGES.length ? it.stage : 0;
      const t = now();
      const createdAt = it.createdAt || t;
      const a = blankApplication({
        ...fields, stage, createdAt, updatedAt: t,
        location: String(it.location || ''), next: String(it.next || ''), notes: String(it.notes || ''),
        url: String(it.url || ''), due: /^\d{4}-\d{2}-\d{2}$/.test(it.due || '') ? it.due : null,
        history: Array.isArray(it.history) && it.history.length ? it.history : [{ stage, at: createdAt }],
      });
      this.data.applications.push(a);
      seen.add(key(a));
      added++;
    }
    this.#save();
    return { added, skipped };
  }

  updateApplication(id, patch) {
    const a = this.#app(id);
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      let v = patch[key];
      if (key === 'stage') {
        this.#setStage(a, Number(v));
        continue;
      } else if (key === 'due') {
        v = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      } else if (key === 'sponsor') {
        if (!SPONSOR.includes(v)) throw new Error('Invalid sponsorship value');
        if (v !== a.sponsor) a.sponsorCheckedAt = v === SPONSOR[0] ? null : now();
      } else {
        v = String(v ?? '');
      }
      a[key] = v;
    }
    if (!a.company.trim()) throw new Error('Company is required');
    a.updatedAt = now();
    this.#save();
  }

  #setStage(a, v) {
    if (!Number.isInteger(v) || v < 0 || v >= STAGES.length) throw new Error('Invalid stage');
    const from = a.stage;
    if (v === from) return;
    const closed = s => s === OFFER || s === REJECTED;
    if (closed(v) && !closed(from)) a.reopen = { next: a.next, due: a.due };
    if (v === REJECTED) { a.next = 'Closed'; a.due = null; }
    else if (v === OFFER) { a.next = 'Offer received'; a.due = null; }
    else if (closed(from)) {
      // Reopening (or undoing a misclick) brings back the next step and deadline it had before.
      a.next = a.reopen ? a.reopen.next : 'Awaiting next step';
      a.due = a.reopen ? a.reopen.due : null;
      a.reopen = null;
    }
    // Going back is a correction, so drop the later steps instead of logging a backwards move.
    if (v < from) while (a.history.length > 1 && a.history.at(-1).stage > v) a.history.pop();
    if (a.history.at(-1)?.stage !== v) a.history.push({ stage: v, at: now() });
    a.stage = v;
  }

  deleteApplication(id) {
    this.#app(id);
    const folder = path.join(this.filesDir, id);
    if (fs.existsSync(folder)) this.trash(folder);
    this.data.files = this.data.files.filter(f => f.appId !== id);
    this.data.applications = this.data.applications.filter(a => a.id !== id);
    this.#save();
  }

  // appId null means the file belongs to the library of master documents.
  addFile({ appId = null, kind = 'other', sourcePath }) {
    if (appId) this.#app(appId);
    if (!KINDS.includes(kind)) kind = 'other';
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error('Only files can be added');
    const id = newId();
    const name = path.basename(sourcePath);
    const rel = path.join(appId || 'library', `${id}-${safeName(name)}`);
    fs.mkdirSync(path.join(this.filesDir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(sourcePath, path.join(this.filesDir, rel));
    this.data.files.push({ id, appId, kind, name, rel, size: stat.size, addedAt: now() });
    if (appId) this.#app(appId).updatedAt = now();
    this.#save();
    return id;
  }

  // Copy a document (usually a master CV from the library) onto an application to tailor it there.
  copyFile(fileId, appId, kind) {
    const f = this.#file(fileId);
    return this.addFile({ appId, kind: kind || f.kind, sourcePath: this.filePath(fileId) });
  }

  updateFile(fileId, { kind }) {
    const f = this.#file(fileId);
    if (KINDS.includes(kind)) f.kind = kind;
    this.#save();
  }

  removeFile(fileId) {
    const f = this.#file(fileId);
    const p = this.filePath(fileId);
    if (fs.existsSync(p)) this.trash(p);
    this.data.files = this.data.files.filter(x => x.id !== fileId);
    this.#save();
    return f;
  }

  filePath(fileId) {
    const f = this.#file(fileId);
    const p = path.resolve(this.filesDir, f.rel);
    if (!p.startsWith(path.resolve(this.filesDir) + path.sep)) throw new Error('Bad file path');
    return p;
  }

  backupTo(destParent) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const dest = path.join(destParent, `Application Workspace backup ${stamp}`);
    fs.cpSync(this.root, dest, { recursive: true, filter: src => !src.endsWith('.tmp') });
    return dest;
  }

  // Replace the workspace with a backup folder. The current workspace is kept beside it first.
  restoreFrom(srcDir) {
    if (path.resolve(srcDir) === path.resolve(this.root)) throw new Error('Choose a backup folder, not the live workspace.');
    if (!fs.existsSync(path.join(srcDir, 'workspace.json'))) {
      throw new Error('That folder is not an Application Workspace backup (no workspace.json inside).');
    }
    JSON.parse(fs.readFileSync(path.join(srcDir, 'workspace.json'), 'utf8'));
    const safety = `${this.root}-before-restore-${Date.now()}`;
    fs.cpSync(this.root, safety, { recursive: true });
    fs.rmSync(this.root, { recursive: true, force: true });
    fs.cpSync(srcDir, this.root, { recursive: true });
    this.data = this.#load();
    return safety;
  }

  loadSample() {
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
    for (const s of sampleApplications(day)) this.data.applications.push(blankApplication({ ...s, sample: true }));
    this.#save();
  }

  clearSample() {
    for (const a of this.data.applications.filter(a => a.sample)) this.deleteApplication(a.id);
  }
}

function sampleApplications(day) {
  const reg = 'On the sponsor register';
  return [
    { company: 'Northbank Capital', role: 'Markets Graduate Analyst', stage: 3, location: 'London, Canary Wharf', sponsor: reg, next: 'Record video interview', due: day(7),
      notes: 'Why Northbank: mid-size desk, analysts rotate across rates and FX in year one.\n\nTalking points\n- MSc dissertation on FX volatility around rate announcements\n- Trading society portfolio, +6.2% over the spring term\n\nQuestions to ask\n- How are rotations decided after the first six months?\n- What does the sponsorship timeline look like for the 2027 intake?' },
    { company: 'Halden Reeve Consulting', role: 'Associate Consultant', stage: 2, location: 'London, Holborn', sponsor: reg, next: 'Numerical test due', due: day(3),
      notes: 'Test is 20 questions in 25 minutes, calculator allowed.\n\nPractice: two timed sets done, weakest on ratio questions.\n\nIf through: case interview next, public-sector practice is their largest.' },
    { company: 'Meridian Rail Systems', role: 'Graduate Systems Engineer', stage: 1, location: 'Derby', sponsor: reg, next: 'Awaiting response',
      notes: 'Careers page says responses within three weeks.\n\nUsed the signalling project from undergrad as the main example.' },
    { company: 'Castlegate Insurance', role: 'Actuarial Graduate', stage: 0, location: 'London, City', sponsor: reg, next: 'Application closes', due: day(12),
      notes: 'Needs a tailored CV. Emphasise the statistics modules and the Excel modelling coursework.\n\nApplication form has three competency questions, 250 words each.' },
    { company: 'Orrin Analytics', role: 'Data Analyst Graduate', stage: 1, location: 'Manchester', sponsor: 'Not on the register', next: 'Awaiting response',
      notes: 'No cover letter requested. Ask recruiter directly about sponsorship before investing more time.' },
    { company: 'Brightwell Health Tech', role: 'Product Graduate', stage: 2, location: "London, King's Cross", sponsor: reg, next: 'Situational judgement test due', due: day(5),
      notes: 'SJT is untimed. Their values page lists four behaviours, answer with those in mind.' },
    { company: 'Fenwick Lowe LLP', role: 'Tax Graduate Programme', stage: 6, location: 'London, Moorgate', sponsor: reg, next: 'Closed',
      notes: 'Rejected after online test. Verbal reasoning score was the weak part. Practise before the next test.' },
  ];
}

module.exports = { Store, STAGES, KINDS, SPONSOR, OFFER, REJECTED };
