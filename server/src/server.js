import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const workbookPath = path.join(root, 'data', 'IPO Tracker Updated.xlsx');
const port = Number(process.env.PORT || 4000);
const adminPin = process.env.ADMIN_PIN || 'change-me';
const syncInterval = 6 * 60 * 60 * 1000; // every 6 hours (fallback poll; also syncs instantly on file change or manual trigger)

let state = { dashboard: {}, ipos: [], applicants: [], sensitiveApplicants: [], lastSynced: null, nextSync: null, error: null, _mtime: 0 };

function maskPan(value) {
  if (!value) return '';
  const s = String(value);
  return s.length <= 4 ? '••••' : `${s.slice(0, 2)}••••${s.slice(-2)}`;
}
function maskId(value) {
  if (!value) return '';
  const s = String(value);
  return s.length <= 5 ? '•••••' : `••••••••${s.slice(-5)}`;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? n * 100 : null; }
function cleanDate(v) { return v instanceof Date ? v.toISOString() : (v ?? null); }

function parseWorkbook() {
  const wb = XLSX.readFile(workbookPath, { cellDates: true });
  const dash = wb.Sheets['Dashboard'];
  const applicantsSheet = wb.Sheets['Applicant Details'];
  if (!dash) throw new Error('Dashboard sheet not found');

  const rows = XLSX.utils.sheet_to_json(dash, { header: 1, defval: null });
  const summary = {};
  for (let i = 2; i <= 7; i++) {
    if (rows[i]?.[0]) summary[String(rows[i][0]).trim()] = rows[i][1];
  }
  const headerIndex = rows.findIndex(r => r?.[0] === 'IPO Id');
  const ipoRows = headerIndex >= 0 ? XLSX.utils.sheet_to_json(dash, { range: headerIndex, defval: null }) : [];
  const ipos = ipoRows.filter(r => r['IPO Id'] != null).map(r => ({
    id: r['IPO Id'], date: cleanDate(r['Date '] ?? r['Date']), name: r['IPO Name'] ?? '',
    applicants: num(r.Applicants), retailAmount: num(r['Retail Amount']), investment: num(r['Total Invesment']),
    allotments: num(r.Allotments), profit: num(r.Profit), roi: pct(r.ROI)
  }));

  const applicants = applicantsSheet
    ? XLSX.utils.sheet_to_json(applicantsSheet, { defval: null }).filter(r => r['Applicant Name'])
    : [];
  const safeApplicants = applicants.map(r => ({
    name: r['Applicant Name'], depository: r['Depository Type'], pan: maskPan(r['PanCard Number']), beneficiaryId: maskId(r['Benificiary Number/ID'])
  }));
  const sensitiveApplicants = applicants.map(r => ({
    name: r['Applicant Name'], depository: r['Depository Type'], pan: r['PanCard Number'], beneficiaryId: r['Benificiary Number/ID']
  }));

  const totalProfit = ipos.reduce((sum, x) => sum + num(x.profit), 0);
  const derivedSummary = {
    'Total IPOs': ipos.length,
    'Total Applications': ipos.reduce((sum, x) => sum + num(x.applicants), 0),
    'Total Allotments': ipos.reduce((sum, x) => sum + num(x.allotments), 0),
    'Total Profit': totalProfit,
    'ROI': totalProfit / 500000,
    'Total Amount': 530000 + totalProfit
  };
  return { summary: derivedSummary, ipos, safeApplicants, sensitiveApplicants };
}

function readWorkbook() {
  try {
    const parsed = parseWorkbook();
    const stat = fs.statSync(workbookPath);
    const now = new Date();
    state = {
      dashboard: parsed.summary,
      ipos: parsed.ipos,
      applicants: parsed.safeApplicants,
      sensitiveApplicants: parsed.sensitiveApplicants,
      lastSynced: now.toISOString(),
      nextSync: new Date(now.getTime() + syncInterval).toISOString(),
      error: null,
      _mtime: stat.mtimeMs
    };
    console.log(`Synced Excel: ${state.ipos.length} IPOs, ${state.applicants.length} applicants`);
  } catch (err) {
    state.error = err.message;
    console.error('Excel sync failed:', err.message);
  }
}

function checkWorkbook() {
  try {
    const stat = fs.statSync(workbookPath);
    if (stat.mtimeMs !== state._mtime) readWorkbook();
    else state.nextSync = new Date(Date.now() + syncInterval).toISOString();
  } catch (err) {
    state.error = err.message;
  }
}

function requirePin(req, res) {
  if (String(req.body?.pin || '') !== adminPin) {
    res.status(401).json({ error: 'Invalid PIN' });
    return false;
  }
  return true;
}

function normalizeIpo(input, fallbackId) {
  const date = input.date ? new Date(input.date) : null;
  return {
    id: input.id ?? fallbackId,
    date: Number.isNaN(date?.getTime?.()) ? null : date,
    name: String(input.name ?? '').trim(),
    applicants: num(input.applicants),
    retailAmount: num(input.retailAmount),
    investment: num(input.investment),
    allotments: num(input.allotments),
    profit: num(input.profit),
    roi: input.investment ? num(input.profit) / num(input.investment) : 0
  };
}

function writeWorkbook({ ipos, applicants }) {
  const wb = XLSX.readFile(workbookPath, { cellDates: true });
  const dash = wb.Sheets['Dashboard'];
  const applicantSheetName = 'Applicant Details';
  if (!dash) throw new Error('Dashboard sheet not found');

  // Keep the existing dashboard structure, but replace the editable IPO table rows.
  const headers = ['IPO Id', 'Date ', 'IPO Name', 'Applicants', 'Retail Amount', 'Total Invesment', 'Allotments', 'Profit', 'ROI'];
  XLSX.utils.sheet_add_aoa(dash, [headers], { origin: 'A11' });
  const ipoValues = ipos.map(x => [x.id, x.date ? new Date(x.date) : null, x.name, num(x.applicants), num(x.retailAmount), num(x.investment), num(x.allotments), num(x.profit), x.investment ? num(x.profit) / num(x.investment) : 0]);
  XLSX.utils.sheet_add_aoa(dash, ipoValues, { origin: 'A12' });

  // Clear old IPO rows beyond the new list, while leaving the dashboard formulas in rows 3-8 intact.
  const oldEnd = Math.max(dash['!ref'] ? XLSX.utils.decode_range(dash['!ref']).e.r + 1 : 1000, 12 + ipos.length);
  for (let r = 12 + ipos.length; r <= Math.min(oldEnd, 1000); r++) {
    for (let c = 0; c < headers.length; c++) {
      delete dash[XLSX.utils.encode_cell({ r: r - 1, c })];
    }
  }

  // Replace applicant rows.
  const appRows = [['Applicant Name', 'Depository Type', 'PanCard Number', 'Benificiary Number/ID'],
    ...applicants.map(x => [x.name, x.depository, x.pan, x.beneficiaryId])];
  const newSheet = XLSX.utils.aoa_to_sheet(appRows);
  wb.Sheets[applicantSheetName] = newSheet;
  if (!wb.SheetNames.includes(applicantSheetName)) wb.SheetNames.push(applicantSheetName);

  // Keep a simple backup before an Admin web edit overwrites the workbook.
  try { fs.copyFileSync(workbookPath, `${workbookPath}.bak`); } catch {}
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.CalcPr = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true };
  XLSX.writeFile(wb, workbookPath, { bookType: 'xlsx' });
  readWorkbook();
}

readWorkbook();
setInterval(checkWorkbook, syncInterval);

// Also sync immediately whenever the Excel file itself changes on disk,
// instead of waiting for the next 6-hour poll.
let watchDebounce = null;
try {
  fs.watch(workbookPath, { persistent: false }, () => {
    clearTimeout(watchDebounce);
    // Debounce briefly - some editors emit several change events for one save.
    watchDebounce = setTimeout(checkWorkbook, 500);
  });
} catch (err) {
  console.error('Could not watch workbook file for changes:', err.message);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: !state.error, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error }));
// Public sync, no PIN required, so any visitor can force a refresh from Excel.
app.post('/api/sync', (_req, res) => {
  readWorkbook();
  res.json({ ok: !state.error, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error });
});
app.get('/api/dashboard', (_req, res) => res.json({ dashboard: state.dashboard, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error }));
app.get('/api/ipos', (_req, res) => res.json({ data: state.ipos, lastSynced: state.lastSynced, nextSync: state.nextSync }));
app.get('/api/applicants', (_req, res) => res.json({ data: state.applicants, lastSynced: state.lastSynced, nextSync: state.nextSync }));

app.post('/api/admin/login', (req, res) => {
  if (!requirePin(req, res)) return;
  res.json({ ok: true });
});

app.post('/api/admin/reveal', (req, res) => {
  if (!requirePin(req, res)) return;
  res.json({ data: state.sensitiveApplicants, lastSynced: state.lastSynced });
});

app.post('/api/admin/sync', (req, res) => {
  if (!requirePin(req, res)) return;
  readWorkbook();
  res.json({ ok: !state.error, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error });
});

app.get('/api/admin/data', (req, res) => {
  if (String(req.headers['x-admin-pin'] || '') !== adminPin) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ ipos: state.ipos, applicants: state.sensitiveApplicants, lastSynced: state.lastSynced });
});

app.put('/api/admin/ipos', (req, res) => {
  if (!requirePin(req, res)) return;
  try {
    const incoming = Array.isArray(req.body?.ipos) ? req.body.ipos : [];
    const ipos = incoming.map((x, i) => normalizeIpo(x, i + 1));
    if (ipos.some(x => !x.name)) return res.status(400).json({ error: 'Every IPO must have a name.' });
    writeWorkbook({ ipos, applicants: state.sensitiveApplicants });
    res.json({ ok: true, data: state.ipos, lastSynced: state.lastSynced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/applicants', (req, res) => {
  if (!requirePin(req, res)) return;
  try {
    const incoming = Array.isArray(req.body?.applicants) ? req.body.applicants : [];
    const applicants = incoming.map(x => ({
      name: String(x.name ?? '').trim(), depository: String(x.depository ?? '').trim(),
      pan: String(x.pan ?? '').trim(), beneficiaryId: String(x.beneficiaryId ?? '').trim()
    }));
    if (applicants.some(x => !x.name)) return res.status(400).json({ error: 'Every applicant must have a name.' });
    writeWorkbook({ ipos: state.ipos, applicants });
    res.json({ ok: true, data: state.sensitiveApplicants, lastSynced: state.lastSynced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const clientDist = path.resolve(root, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(port, () => console.log(`IPO Tracker server running on http://localhost:${port}`));