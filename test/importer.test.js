const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { readTable, interpret, matchDocuments, parseDate, guessField, colourName, distance } = require('../src/importer');
const { Store, STAGES } = require('../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-'));
const TODAY = new Date('2026-11-15T12:00:00Z');
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

async function sampleWorkbook() {
  const file = path.join(tmp(), 'tracker.xlsx');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Summary').addRow(['Totals', 3]);
  const ws = wb.addWorksheet('Tracker');
  ws.addRow(['Company', 'Role', 'Track', 'Application Sent', 'Online Assessment', 'Video Interview', '1st Round', 'Final / AC', 'Outcome', 'Days Since Activity', 'Additional Info']);
  const d = s => new Date(`${s}T00:00:00Z`);
  ws.addRow(['Acme', 'Analyst', 'Consulting', d('2026-09-01'), d('2026-09-10'), null, d('2026-10-02'), null, null, { formula: 'TODAY()-G2', result: 44 }, 'Case went well; password: hunter2']);
  ws.addRow(['Borealis', 'Graduate', 'Tech', d('2026-09-05'), null, null, null, null, null, { formula: 'TODAY()-D3', result: 71 }, null]);
  ws.addRow(['Cobalt', 'Intern', 'Tech', d('2026-09-07'), d('2026-09-20'), d('2026-09-28'), null, null, null, { formula: 'TODAY()-F4', result: 48 }, null]);
  ws.addRow(['Dune', 'Associate', null, d('2026-09-09'), null, null, null, null, 'Offer', { formula: 'TODAY()-D5', result: 67 }, null]);
  ws.addRow(['Ember', 'Analyst', null, null, null, null, null, null, null, null, 'EXAMPLE ROW - delete me']);
  ws.addRow(['Flint', 'Analyst', null, null, null, null, null, null, null, { formula: '""', result: '' }, null]);
  for (let r = 2; r <= 7; r++) ws.getCell(r, 10).fill = fill('FFE2EFDA'); // column styling, on every row
  ws.getCell('A3').fill = fill('FFC00000');
  ws.getCell('A4').fill = fill('FFFFC000');
  await wb.xlsx.writeFile(file);
  return file;
}

test('recognises column headers, however they are worded', () => {
  const expected = { 'Firm': 'company', 'Job title': 'role', 'Video Interview': 'video', 'Online Assessment': 'online', 'OA': 'online',
    'Assessment centre': 'interview', '2nd Round / Case': 'interview', 'Application deadline': 'deadline', 'Date applied': 'applied',
    'Application Sent': 'applied', 'Status': 'status', 'Next Action': 'next', 'Additional Info': 'notes', 'Days Since Activity': 'ignore', 'Tier': null };
  for (const [header, field] of Object.entries(expected)) assert.equal(guessField(header), field, header);
});

test('reads dates in the common ways people type them', () => {
  assert.equal(parseDate('2026-09-12', TODAY), '2026-09-12');
  assert.equal(parseDate('12/09/2026', TODAY), '2026-09-12');
  assert.equal(parseDate('9/25/26', TODAY), '2026-09-25');
  assert.equal(parseDate('12 Sep', TODAY), '2026-09-12');
  assert.equal(parseDate('27-Oct-26', TODAY), '2026-10-27');
  assert.equal(parseDate('October 3rd, 2026', TODAY), '2026-10-03');
  assert.equal(parseDate('15 Jan', TODAY), '2026-01-15');
  assert.equal(parseDate('TBC', TODAY), null);
  assert.equal(parseDate('31/02/2026', TODAY), null);
});

test('names colours and tolerates typos', () => {
  assert.equal(colourName('C00000'), 'Red');
  assert.equal(colourName('FFC000'), 'Orange');
  assert.equal(colourName('E2EFDA'), 'Green');
  assert.equal(colourName('EDEDED'), 'Grey');
  assert.equal(distance('ekmetrics', 'ekimterics'), 2);
  assert.equal(distance('capgenimi', 'capgemini'), 2);
});

test('turns an Excel tracker into applications with stages, dates and colours', async () => {
  const table = await readTable(await sampleWorkbook());
  assert.equal(table.sheet, 'Tracker');
  const out = interpret(table, {}, TODAY);
  const by = Object.fromEntries(out.items.map(i => [i.company, i]));
  assert.deepEqual(Object.keys(by), ['Acme', 'Borealis', 'Cobalt', 'Dune', 'Flint']); // the example row is dropped

  assert.equal(STAGES[by.Acme.stage], 'Interview');
  assert.deepEqual(by.Acme.history.map(h => [h.stage, h.at.slice(0, 10)]), [[0, '2026-09-01'], [1, '2026-09-01'], [2, '2026-09-10'], [4, '2026-10-02']]);
  assert.equal(by.Acme.notes.timeline, 'Application Sent 1 Sep 2026 · Online Assessment 10 Sep 2026 · 1st Round 2 Oct 2026');
  assert.deepEqual(by.Acme.notes.info, ['Case went well']);
  assert.ok(by.Acme.flags.includes('A password was left out'));
  assert.deepEqual(by.Acme.notes.extras, ['Track: Consulting']);

  assert.equal(STAGES[by.Borealis.stage], 'Rejected'); // red row
  assert.equal(STAGES[by.Cobalt.stage], 'Video interview'); // orange means nothing until the user says so
  assert.equal(STAGES[by.Dune.stage], 'Offer'); // from the Outcome column
  assert.equal(STAGES[by.Flint.stage], 'Shortlisted');
  assert.ok(by.Flint.flags[0].startsWith('No dates found'));

  // The green formula column is styling, not a signal.
  assert.deepEqual(out.colors.map(c => [c.name, c.count, c.meaning]), [['Red', 1, 'rejected'], ['Orange', 1, 'none']]);
  assert.equal(out.headers.find(h => h.name === 'Track').unsure, true);
  assert.equal(out.mapping[9], 'ignore');
  assert.ok(!JSON.stringify(out).includes('hunter2')); // passwords never reach the screen or the app
});

test('the user’s choices override the guesses', async () => {
  const table = await readTable(await sampleWorkbook());
  const out = interpret(table, {
    mapping: { 2: 'ignore' },
    colors: [{ hex: 'C00000', meaning: 'none' }, { hex: 'FFC000', meaning: 'note', label: 'Pending decision' }],
    overrides: { 3: { stage: 2 }, 5: { skip: true } },
  }, TODAY);
  const by = Object.fromEntries(out.items.map(i => [i.company, i]));
  assert.equal(STAGES[by.Borealis.stage], 'Online test');
  assert.equal(by.Cobalt.notes.label, 'Pending decision');
  assert.deepEqual(by.Acme.notes.extras, []);
  assert.equal(by.Dune.skip, true);
});

test('reads a CSV with its own wording and text dates', async () => {
  const file = path.join(tmp(), 'jobs.csv');
  fs.writeFileSync(file, 'Firm,Position,Date applied,Interview,Status,Comments\n"Gamma, Inc",Analyst,03/10/2026,,Rejected,"Said ""no"" by email"\nHelix,Engineer,5 Oct,20 Oct,,\n');
  const out = interpret(await readTable(file), {}, TODAY);
  assert.deepEqual(out.items.map(i => [i.company, STAGES[i.stage]]), [['Gamma, Inc', 'Rejected'], ['Helix', 'Interview']]);
  assert.deepEqual(out.items[0].notes.info, ['Said "no" by email']);
  assert.equal(out.items[1].history.at(-1).at.slice(0, 10), '2026-10-20');
});

test('explains unsupported files', async () => {
  const file = path.join(tmp(), 'old.xls');
  fs.writeFileSync(file, 'x');
  await assert.rejects(readTable(file), /save or export it as Excel/);
});

test('importing is a sync: adds, moves forward, never backwards, and can be undone', async () => {
  const s = new Store(tmp());
  const table = await readTable(await sampleWorkbook());
  const first = interpret(table, {}, TODAY);
  assert.deepEqual(s.planImport(first.items).map(p => p.action), ['new', 'new', 'new', 'new', 'new']);
  assert.deepEqual(s.syncApplications(first.items), { added: 5, updated: 0, unchanged: 0 });
  assert.deepEqual(s.syncApplications(first.items), { added: 0, updated: 0, unchanged: 5 });

  const apps = () => Object.fromEntries(s.snapshot().applications.map(a => [a.company, a]));
  assert.match(apps().Acme.notes, /^Track: Consulting\nTimeline: Application Sent 1 Sep 2026.*\n\nFrom my tracker:\n- Case went well$/s);
  s.updateApplication(apps().Acme.id, { stage: 5 });      // the user records an offer in the app…
  s.updateApplication(apps().Flint.id, { notes: 'Mine' }); // …and writes their own notes

  // The sheet later shows Cobalt further along and still shows Acme at interview.
  const later = interpret(table, { overrides: { 4: { stage: 4 } }, colors: [{ hex: 'FFC000', meaning: 'note', label: 'Pending' }] }, TODAY);
  const plan = Object.fromEntries(s.planImport(later.items).map((p, i) => [later.items[i].company, p]));
  assert.equal(plan.Cobalt.action, 'update');
  assert.equal(plan.Acme.action, 'same');
  assert.match(plan.Acme.changes[0], /Kept at Offer/);
  assert.deepEqual(s.syncApplications(later.items), { added: 0, updated: 1, unchanged: 4 });
  assert.equal(STAGES[apps().Cobalt.stage], 'Interview');
  assert.match(apps().Cobalt.notes, /Marked in my tracker: Pending/);
  assert.equal(STAGES[apps().Acme.stage], 'Offer');
  assert.equal(apps().Flint.notes, 'Mine');

  s.undoImport();
  assert.equal(STAGES[apps().Cobalt.stage], 'Video interview');
  assert.throws(() => s.undoImport(), /Nothing to undo/);

  // A role worded differently in the sheet still finds the one application for that company.
  const reworded = later.items.map(i => (i.company === 'Flint' ? { ...i, role: 'Graduate Analyst 2027' } : i));
  assert.match(s.planImport(reworded).at(-1).changes[0], /Matched to “Analyst”/);
  assert.equal(s.syncApplications(reworded).added, 0);
});

test('matches CVs and cover letters to applications by folder and file name', () => {
  const root = path.join(tmp(), 'CV');
  const put = rel => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, rel); };
  ['CVs/Mckinsey/Cliff_CV.pdf', 'CVs/OC&C/CV final.docx', 'CVs (tech)/Ekmetrics/cv.pdf', 'CVs (tech)/Google APM/CV_PM.pdf',
    'CVs (tech)/Amazon/CV.pdf', 'Cover letter/CL - Kearney.docx', 'Cover letter/CL - CIL.docx', 'CV_CLIFF.pdf',
    'Past transcript/Degree.pdf', 'CVs/~$temp.docx', 'CVs/BCG/photo.jpg', 'CVs/Black Rock/Resume.pdf'].forEach(put);
  const apps = [['m', 'Mckinsey', 'Business Analyst'], ['o', 'OC&C', 'Strategy'], ['e', 'Ekimterics', 'Intern'],
    ['g1', 'Google', 'Associate Product Manager Internship'], ['g2', 'Google', 'Software Engineer'],
    ['a1', 'Amazon', 'Business analyst Internship'], ['a2', 'Amazon', 'Program manager Intern'],
    ['k', 'Kearney', 'Grad analyst'], ['c', 'CIL Strategy', 'Graduate analyst'], ['b', 'Black Rock', 'Rotational']]
    .map(([id, company, role]) => ({ id, company, role }));
  fs.writeFileSync(path.join(root, 'CVs/Mckinsey/old.pdf'), 'x');
  const out = matchDocuments([root], apps, [{ appId: 'm', name: 'old.pdf', size: 1 }]);
  const by = Object.fromEntries(out.map(f => [`${f.folder ? f.folder + '/' : ''}${f.name}`, f]));
  const pick = k => [by[k].dest, by[k].kind, by[k].confidence];

  assert.equal(out.length, 11); // temp files and images are left out
  assert.deepEqual(pick('CVs / Mckinsey/Cliff_CV.pdf'), ['m', 'cv', 'sure']);
  assert.deepEqual(pick('CVs / OC&C/CV final.docx'), ['o', 'cv', 'sure']);
  assert.deepEqual(pick('CVs (tech) / Ekmetrics/cv.pdf'), ['e', 'cv', 'check']); // typo-tolerant, but flagged
  assert.deepEqual(pick('CVs (tech) / Google APM/CV_PM.pdf'), ['g1', 'cv', 'sure']); // APM = Associate Product Manager
  assert.equal(by['CVs (tech) / Amazon/CV.pdf'].confidence, 'check'); // two Amazon roles: the user picks
  assert.deepEqual(by['CVs (tech) / Amazon/CV.pdf'].candidates.sort(), ['a1', 'a2']);
  assert.deepEqual(pick('CV / Cover letter/CL - Kearney.docx'), ['k', 'cover', 'sure']);
  assert.deepEqual(pick('CV / Cover letter/CL - CIL.docx'), ['c', 'cover', 'sure']);
  assert.deepEqual(pick('CVs / Black Rock/Resume.pdf'), ['b', 'cv', 'sure']);
  assert.deepEqual(pick('CV/CV_CLIFF.pdf'), ['skip', 'cv', 'none']);
  assert.deepEqual(pick('CV / Past transcript/Degree.pdf'), ['skip', 'cv', 'none']);
  assert.deepEqual(pick('CVs / Mckinsey/old.pdf'), ['skip', 'cv', 'already']);
});
