// Reads someone's existing tracker (Excel or CSV) and their folder of CVs and cover letters, and
// works out what belongs where. Everything here is a best guess that the Import screen shows for
// review before anything is saved. No Electron imports, so it can be tested with plain Node.
const fs = require('node:fs');
const path = require('node:path');

const STAGES = ['Shortlisted', 'Applied', 'Online test', 'Video interview', 'Interview', 'Offer', 'Rejected'];
const OFFER = 5, REJECTED = 6;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// What a spreadsheet column can be used for.
const FIELDS = [
  ['company', 'Company'], ['role', 'Role'], ['location', 'Location'], ['deadline', 'Deadline'],
  ['applied', 'Date applied'], ['online', 'Online test date'], ['video', 'Video interview date'],
  ['interview', 'Interview round date'], ['offer', 'Offer date'], ['status', 'Status / outcome'],
  ['next', 'Next step'], ['notes', 'Notes'], ['link', 'Job link'], ['salary', 'Salary'],
  ['extra', 'Keep as a labelled note'], ['ignore', 'Ignore this column'],
];
const STAGE_OF = { applied: 1, online: 2, video: 3, interview: 4, offer: 5 };
const WAITING = { 0: 'Prepare application', 1: 'Awaiting response', 2: 'Awaiting online test result', 3: 'Awaiting video interview outcome', 4: 'Awaiting interview outcome', 5: 'Offer received', 6: 'Closed' };

// Order matters: "Video Interview" must hit video before interview, "Assessment centre" before online.
const HEADER_RULES = [
  [/days since|^id$|^no$|^#$/, 'ignore'],
  [/assessment cent|\bac\b|superday|final|round|case|partner/, 'interview'],
  [/video|\bvi\b|hirevue|recorded/, 'video'],
  [/online|assessment|\boa\b|test|aptitude|sjt|numerical|psychometric/, 'online'],
  [/interview/, 'interview'],
  [/deadline|closing|closes|due/, 'deadline'],
  [/offer/, 'offer'],
  [/appl\w* (sent|date|on)|^applied|date applied|submitted|^sent|date added|^added/, 'applied'],
  [/status|outcome|result|stage|progress/, 'status'],
  [/next|action|to do|todo|follow/, 'next'],
  [/note|info|comment|remark|detail/, 'notes'],
  [/link|url|posting|website/, 'link'],
  [/salary|pay|compensation/, 'salary'],
  [/company|firm|employer|organi[sz]ation|^name$/, 'company'],
  [/role|position|title|job|program/, 'role'],
  [/location|city|office|country/, 'location'],
];

function guessField(header) {
  const h = String(header || '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
  if (!h) return null;
  for (const [re, field] of HEADER_RULES) if (re.test(h)) return field;
  return null;
}

/* ---------- dates ---------- */
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
const fullYear = y => (y < 100 ? 2000 + y : y);
// A date written without a year is taken as the most recent sensible one (not far in the future).
function guessYear(m, d, today = new Date()) {
  const y = today.getFullYear();
  const candidate = new Date(y, m - 1, d);
  return candidate - today > 183 * 864e5 ? y - 1 : y;
}

function parseDate(value, today = new Date()) {
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString().slice(0, 10);
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/))) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // written month-first
    return iso(m[3] ? fullYear(+m[3]) : guessYear(mo, d, today), mo, d);
  }
  const mon = t => MON.findIndex(x => t.toLowerCase().startsWith(x.toLowerCase())) + 1;
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3,9})\.?(?:[\s\-/,]+(\d{2,4}))?$/)) && mon(m[2])) {
    return iso(m[3] ? fullYear(+m[3]) : guessYear(mon(m[2]), +m[1], today), mon(m[2]), +m[1]);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?$/)) && mon(m[1])) {
    return iso(m[3] ? fullYear(+m[3]) : guessYear(mon(m[1]), +m[2], today), mon(m[1]), +m[2]);
  }
  return null;
}
const showDate = s => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };

/* ---------- colours ---------- */
const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

function fillHex(fill) {
  if (!fill || fill.type !== 'pattern' || !fill.pattern || fill.pattern === 'none') return null;
  const c = fill.fgColor || fill.bgColor;
  if (!c) return null;
  let hex = null;
  if (c.argb) hex = c.argb.slice(-6);
  else if (c.theme != null && OFFICE_THEME[c.theme]) {
    const t = c.tint || 0;
    hex = OFFICE_THEME[c.theme].match(/../g).map(p => {
      const v = parseInt(p, 16);
      return Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)).toString(16).padStart(2, '0');
    }).join('');
  }
  if (!hex) return null;
  hex = hex.toUpperCase();
  return hex === 'FFFFFF' || (c.argb && c.argb.slice(0, 2) === '00' && hex === '000000') ? null : hex;
}

function colourName(hex) {
  const [r, g, b] = hex.match(/../g).map(p => parseInt(p, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return l > 0.93 ? null : 'Grey';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h < 15 || h >= 345 ? 'Red' : h < 50 ? 'Orange' : h < 70 ? 'Yellow' : h < 170 ? 'Green' : h < 255 ? 'Blue' : h < 290 ? 'Purple' : 'Pink';
}

/* ---------- reading the file ---------- */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellFromExcel(cell) {
  let v = cell.value, formula = false, link = null;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) v = v.richText.map(t => t.text).join('');
    else if ('hyperlink' in v) { link = v.hyperlink; v = v.text; }
    else if ('formula' in v || 'sharedFormula' in v) { formula = true; v = v.result ?? ''; }
    else if ('error' in v) v = '';
    if (v && typeof v === 'object' && !(v instanceof Date)) v = v.text || v.result || '';
  }
  const date = v instanceof Date ? parseDate(v) : null;
  return { text: date ? showDate(date) : String(v ?? '').trim(), date, color: fillHex(cell.fill), formula, link };
}

// Returns every sheet as a grid of { text, date, color, formula, link } cells.
async function readGrids(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const delimiter = ext === '.tsv' || (text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length) ? '\t' : ',';
    return [{ name: path.basename(file), grid: parseCsv(text, delimiter).map(r => r.map(t => ({ text: t.trim(), date: null, color: null, formula: false, link: null }))) }];
  }
  if (ext !== '.xlsx' && ext !== '.xlsm') {
    throw new Error(ext === '.xls' || ext === '.numbers'
      ? 'That file type can’t be read directly. Open it and save or export it as Excel (.xlsx) or CSV, then drop that in.'
      : 'Drop an Excel (.xlsx) or CSV file. From Google Sheets, use File › Download › Microsoft Excel.');
  }
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.filter(ws => ws.state !== 'hidden' || wb.worksheets.length === 1).map(ws => {
    const grid = [];
    const width = Math.min(ws.columnCount, 60);
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n > 3000) return;
      const cells = [];
      for (let c = 1; c <= width; c++) cells.push(cellFromExcel(row.getCell(c)));
      grid[n - 1] = cells;
    });
    return { name: ws.name, grid: Array.from(grid, r => r || []) };
  });
}

// Picks the sheet and header row that look most like a tracker.
function findTable(sheets) {
  let best = null;
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(sheet.grid.length, 15); r++) {
      const fields = sheet.grid[r].map(c => guessField(c.text));
      const score = new Set(fields.filter(Boolean)).size + (fields.includes('company') ? 3 : 0);
      if (!best || score > best.score) best = { sheet, headerRow: r, score };
    }
  }
  if (!best || !best.sheet.grid.length) throw new Error('That file looks empty.');
  if (best.score < 2) best = { ...best, headerRow: best.sheet.grid.findIndex(r => r.some(c => c.text)) };
  const header = best.sheet.grid[best.headerRow];
  const rows = [];
  for (let r = best.headerRow + 1; r < best.sheet.grid.length; r++) {
    if (best.sheet.grid[r].some(c => c.text)) rows.push({ n: r + 1, cells: best.sheet.grid[r] });
  }
  return { sheet: best.sheet.name, headers: header.map(c => c.text), rows };
}

async function readTable(file) {
  return { file: path.basename(file), ...findTable(await readGrids(file)) };
}

/* ---------- interpreting it ---------- */
function guessMapping(table) {
  const used = new Set(), mapping = {}, unsure = {};
  table.headers.forEach((name, i) => {
    const filled = table.rows.filter(r => r.cells[i]?.text);
    let field = guessField(name);
    // An empty column still gets its obvious meaning, so it's right once the user fills it in.
    if (!filled.length && (!field || field === 'company' || field === 'role')) { mapping[i] = 'ignore'; return; }
    if ((field === 'company' || field === 'role') && used.has(field)) field = null;
    if (!field) {
      const formulas = filled.filter(r => r.cells[i].formula).length;
      field = !name || formulas > filled.length / 2 ? 'ignore' : 'extra';
      // Named columns we don't recognise are worth a second look; unnamed scraps are not.
      unsure[i] = Boolean(name) && field === 'extra';
    }
    if (field === 'company' || field === 'role') used.add(field);
    mapping[i] = field;
  });
  if (!used.has('company')) {
    const first = table.headers.findIndex((_, i) => mapping[i] !== 'ignore' && table.rows.some(r => r.cells[i]?.text && !r.cells[i].date));
    if (first >= 0) { mapping[first] = 'company'; unsure[first] = true; }
  }
  return { mapping, unsure };
}

// A fill shared by nearly every row of a column is the sheet's styling, not a signal about one row.
function rowColours(table, rows) {
  const styling = new Set();
  table.headers.forEach((_, i) => {
    const counts = {};
    for (const r of rows) { const c = r.cells[i]?.color; if (c) counts[c] = (counts[c] || 0) + 1; }
    for (const [c, n] of Object.entries(counts)) if (rows.length >= 4 && n > rows.length * 0.85) styling.add(`${i}:${c}`);
  });
  return rows.map(r => {
    const counts = {};
    r.cells.forEach((cell, i) => {
      if (cell.color && !styling.has(`${i}:${cell.color}`) && colourName(cell.color)) counts[cell.color] = (counts[cell.color] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  });
}

const looksSecret = s => /pass\s*-?\s*word|passcode|\bpwd\b/i.test(s);
const TRUTHY = /^(y|yes|done|x|✓|✔|true|completed?|passed|sent)$/i;

function statusStage(text) {
  if (/reject|unsuccessful|declin|not progress|fail|no response|ghost|withdr|closed/i.test(text)) return REJECTED;
  if (/offer|accepted/i.test(text)) return OFFER;
  return null;
}

// opts: { mapping, colors: [{ hex, meaning, label }], overrides: { [rowNumber]: { skip, stage } } }
function interpret(table, opts = {}, today = new Date()) {
  const guess = guessMapping(table);
  const mapping = { ...guess.mapping, ...(opts.mapping || {}) };
  const cols = field => table.headers.map((_, i) => i).filter(i => mapping[i] === field);
  const companyCol = cols('company')[0];
  if (companyCol == null) throw new Error('Choose which column holds the company name.');

  const rows = table.rows.filter(r => r.cells[companyCol]?.text && !r.cells.some(c => /example row/i.test(c.text)));
  const colourOf = rowColours(table, rows);
  const chosen = Object.fromEntries((opts.colors || []).map(c => [c.hex, c]));
  const colours = {};
  colourOf.forEach(hex => {
    if (!hex) return;
    const name = colourName(hex);
    colours[hex] ||= { hex, name, count: 0, meaning: chosen[hex]?.meaning || (name === 'Red' ? 'rejected' : 'none'), label: chosen[hex]?.label ?? '' };
    colours[hex].count++;
  });

  const first = (r, field) => cols(field).map(i => r.cells[i]?.text).find(Boolean) || '';
  const nowIso = today.toISOString();
  const at = d => `${d}T09:00:00.000Z`;

  const items = rows.map((r, idx) => {
    const flags = [];
    const steps = []; // { stage, date|null, label }
    for (const field of Object.keys(STAGE_OF)) {
      for (const i of cols(field)) {
        const cell = r.cells[i];
        if (!cell?.text) continue;
        const date = cell.date || parseDate(cell.text, today);
        if (date || TRUTHY.test(cell.text)) steps.push({ stage: STAGE_OF[field], date, label: table.headers[i] || FIELDS.find(f => f[0] === field)[1] });
        else flags.push(`Couldn’t read “${cell.text}” in ${table.headers[i]} as a date`);
      }
    }
    let stage = steps.reduce((m, s) => Math.max(m, s.stage), 0);
    const statusText = first(r, 'status');
    const fromStatus = statusText ? statusStage(statusText) : null;
    if (fromStatus != null) stage = fromStatus;
    const colour = colourOf[idx] && colours[colourOf[idx]];
    if (colour?.meaning === 'rejected') stage = REJECTED;
    else if (colour?.meaning === 'offer') stage = OFFER;
    if (!steps.length && stage === 0) flags.push('No dates found, so it starts as Shortlisted');

    const override = opts.overrides?.[r.n] || {};
    if (Number.isInteger(override.stage)) stage = override.stage;

    const dated = steps.filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date) || a.stage - b.stage);
    const history = [];
    if (dated.length) history.push({ stage: 0, at: at(dated[0].date) });
    for (const s of dated) if (s.stage <= stage && history.at(-1).stage < s.stage) history.push({ stage: s.stage, at: at(s.date) });
    if (!history.length) history.push({ stage: 0, at: nowIso });
    if (history.at(-1).stage !== stage) history.push({ stage, at: stage >= OFFER || !dated.length ? nowIso : history.at(-1).at });

    const info = [];
    for (const i of cols('notes')) {
      for (const part of (r.cells[i]?.text || '').split(/\s*;\s*|\n+/).map(p => p.trim()).filter(Boolean)) {
        if (looksSecret(part)) flags.push('A password was left out');
        else info.push(part);
      }
    }
    const extras = cols('extra').filter(i => r.cells[i]?.text && !looksSecret(r.cells[i].text))
      .map(i => `${table.headers[i] || 'Note'}: ${r.cells[i].text}`);
    const deadlineText = first(r, 'deadline');
    const linkCell = cols('link').map(i => r.cells[i]).find(c => c?.text || c?.link);

    return {
      n: r.n, skip: Boolean(override.skip),
      company: r.cells[companyCol].text, role: first(r, 'role'), location: first(r, 'location'),
      due: deadlineText ? parseDate(deadlineText, today) : null,
      stage, history, createdAt: history[0].at,
      next: first(r, 'next') || WAITING[stage],
      url: linkCell ? (linkCell.link || linkCell.text) : '', salary: first(r, 'salary'),
      notes: {
        extras,
        timeline: dated.map(s => `${s.label} ${showDate(s.date)}`).join(' · '),
        label: colour?.meaning === 'note' && colour.label.trim() ? colour.label.trim() : '',
        info,
      },
      colour: colourOf[idx], flags: [...new Set(flags)],
    };
  });

  return {
    file: table.file, sheet: table.sheet,
    headers: table.headers.map((name, index) => ({
      index, name, field: mapping[index], unsure: Boolean(guess.unsure[index]) && !(opts.mapping && index in opts.mapping),
      sample: table.rows.map(r => r.cells[index]?.text).find(t => t && !looksSecret(t)) || '',
    })).filter(h => h.name || h.sample),
    mapping, fields: FIELDS, stages: STAGES,
    colors: Object.values(colours).sort((a, b) => b.count - a.count),
    items,
  };
}

/* ---------- documents ---------- */
const DOC_EXT = new Set(['.pdf', '.doc', '.docx', '.pages', '.odt', '.rtf', '.txt']);
const GENERIC = new Set(['consulting', 'consultancy', 'strategy', 'group', 'llp', 'ltd', 'limited', 'plc', 'inc', 'the', 'co', 'company', 'and', 'uk', 'capital', 'partners', 'global', 'international']);
const ROLE_GENERIC = new Set(['graduate', 'grad', 'intern', 'internship', 'programme', 'program', 'analyst', 'associate', 'the', 'and', 'for', 'entry']);
const tokens = s => String(s).toLowerCase().replace(/&/g, '').split(/[^a-z0-9]+/).filter(Boolean);

// Edit distance that counts a swapped pair of letters as one slip (so "Ekmetrics" finds "Ekimterics").
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function listFiles(paths, limit = 600) {
  const out = [];
  const walk = (p, depth) => {
    if (out.length >= limit) return;
    const name = path.basename(p);
    if (name.startsWith('.') || name.startsWith('~$')) return;
    let stat;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      if (depth > 6) return;
      let names = [];
      try { names = fs.readdirSync(p).sort(); } catch { return; }
      for (const n of names) walk(path.join(p, n), depth + 1);
    } else if (stat.isFile() && DOC_EXT.has(path.extname(name).toLowerCase())) {
      out.push({ path: p, name, size: stat.size, root: depth === 0 ? path.dirname(p) : null });
    }
  };
  for (const p of paths) {
    const before = out.length;
    walk(p, 0);
    // Folder names only count as hints inside what the user dropped, not their whole disk.
    for (let i = before; i < out.length; i++) out[i].root ||= path.dirname(p);
  }
  return out;
}

function docKind(nameTokens, folderTokens) {
  const cover = t => ['cl', 'cover', 'letter', 'letters', 'coverletter', 'motivation'].includes(t);
  const cv = t => ['cv', 'cvs', 'resume', 'resumes', 'curriculum'].includes(t);
  if (nameTokens.some(cover)) return 'cover';
  if (nameTokens.some(cv)) return 'cv';
  if (folderTokens.some(cover)) return 'cover';
  if (folderTokens.some(cv)) return 'cv';
  return 'other';
}

// applications: [{ id, company, role, stage }], existing: [{ appId, name, size }]
function matchDocuments(paths, applications, existing = []) {
  const apps = applications.map(a => {
    const t = tokens(a.company).filter(x => !GENERIC.has(x));
    const all = t.length ? t : tokens(a.company);
    const roleTokens = tokens(a.role).filter(x => x.length >= 3 && !ROLE_GENERIC.has(x));
    return { ...a, key: all.join(''), primary: all[0] && all[0].length >= 3 ? all[0] : all.join(''), roleTokens, initials: tokens(a.role).map(x => x[0]).join('') };
  }).filter(a => a.key);

  return listFiles(paths).map(f => {
    const rel = path.relative(f.root, f.path).split(path.sep);
    const folders = rel.slice(0, -1).slice(-2);
    const nameTokens = tokens(path.basename(f.name, path.extname(f.name)));
    const folderTokens = folders.flatMap(tokens);
    const all = [...nameTokens, ...folderTokens];
    const joined = [nameTokens.join(''), ...folders.map(x => tokens(x).join(''))];

    const scored = apps.map(a => {
      let score = 0;
      if (all.includes(a.primary) || (a.key.length >= 4 && joined.some(j => j.includes(a.key)))) score = 2;
      else if (a.primary.length >= 5 && all.some(t => t.length >= 4 && distance(t, a.primary) <= Math.floor(a.primary.length / 4))) score = 1;
      const roleHits = a.roleTokens.filter(t => all.includes(t)).length
        + (all.some(t => t.length >= 2 && t.length <= 5 && a.initials.length >= 2 && a.initials.startsWith(t) && !a.roleTokens.includes(t) && t !== a.primary) ? 1 : 0);
      return { a, score, roleHits };
    }).filter(x => x.score > 0);

    const top = Math.max(0, ...scored.map(x => x.score));
    let candidates = scored.filter(x => x.score === top);
    let confidence = !candidates.length ? 'none' : top === 2 ? 'sure' : 'check';
    let why = !candidates.length ? 'No company name found in the file or folder name' : top === 2 ? '' : `Name is close to “${candidates[0].a.company}”`;
    if (candidates.length > 1) {
      const bestRole = Math.max(...candidates.map(x => x.roleHits));
      const narrowed = candidates.filter(x => x.roleHits === bestRole);
      if (bestRole > 0 && narrowed.length === 1) candidates = [narrowed[0], ...candidates.filter(x => x !== narrowed[0])];
      else { confidence = 'check'; why = `${candidates.length} applications match this company, so pick the role`; }
    }
    const kind = docKind(nameTokens, folderTokens);
    const appId = candidates[0]?.a.id || null;
    const already = Boolean(appId) && existing.some(e => e.appId === appId && e.name === f.name && e.size === f.size);
    return {
      path: f.path, name: f.name, size: f.size, folder: folders.join(' / '), kind,
      dest: already || !appId ? 'skip' : appId, confidence: already ? 'already' : confidence,
      why: already ? 'Already stored with this application' : why,
      candidates: candidates.map(x => x.a.id),
    };
  });
}

module.exports = { readTable, interpret, matchDocuments, parseDate, guessField, colourName, distance, FIELDS, WAITING };
