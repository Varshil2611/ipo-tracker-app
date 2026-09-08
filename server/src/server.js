import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchData, writeIposRemote, writeApplicantsRemote } from './appsScript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4000);
const adminPin = process.env.ADMIN_PIN || 'change-me';
const syncInterval = Number(process.env.SYNC_INTERVAL_MS || 5 * 60 * 1000); // default: 5 minutes

let state = {
  dashboard: {},
  ipos: [],
  applicants: [],
  sensitiveApplicants: [],
  lastSynced: null,
  nextSync: null,
  error: null,
};

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
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function syncNow() {
  try {
    const raw = await fetchData();
    const ipos = (raw.ipos || []).map((x) => ({
      id: x.id,
      date: x.date || null,
      name: x.name || '',
      applicants: num(x.applicants),
      retailAmount: num(x.retailAmount),
      investment: num(x.investment),
      allotments: num(x.allotments),
      profit: num(x.profit),
      roi: num(x.roi) * 100,
    }));
    const sensitiveApplicants = (raw.applicants || []).map((a) => ({
      name: a.name || '',
      depository: a.depository || '',
      pan: a.pan || '',
      beneficiaryId: a.beneficiaryId || '',
    }));
    const safeApplicants = sensitiveApplicants.map((a) => ({
      name: a.name,
      depository: a.depository,
      pan: maskPan(a.pan),
      beneficiaryId: maskId(a.beneficiaryId),
    }));

    const totalProfit = ipos.reduce((sum, x) => sum + num(x.profit), 0);
    const totalInvestment = ipos.reduce((sum, x) => sum + num(x.investment), 0);
    const dashboard = {
      'Total IPOs': ipos.length,
      'Total Applications': ipos.reduce((sum, x) => sum + num(x.applicants), 0),
      'Total Allotments': ipos.reduce((sum, x) => sum + num(x.allotments), 0),
      'Total Profit': totalProfit,
      ROI: totalInvestment ? (totalProfit / totalInvestment) * 100 : 0,
      'Total Amount': totalInvestment + totalProfit,
    };

    const now = new Date();
    state = {
      dashboard,
      ipos,
      applicants: safeApplicants,
      sensitiveApplicants,
      lastSynced: now.toISOString(),
      nextSync: new Date(now.getTime() + syncInterval).toISOString(),
      error: null,
    };
    console.log(`Synced Google Sheet: ${state.ipos.length} IPOs, ${state.applicants.length} applicants`);
  } catch (err) {
    state.error = err.message;
    console.error('Sheet sync failed:', err.message);
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
  return {
    id: input.id ?? fallbackId,
    date: input.date ? String(input.date).slice(0, 10) : null,
    name: String(input.name ?? '').trim(),
    applicants: num(input.applicants),
    retailAmount: num(input.retailAmount),
    investment: num(input.investment),
    allotments: num(input.allotments),
    profit: num(input.profit),
    roi: input.investment ? num(input.profit) / num(input.investment) : 0,
  };
}

await syncNow();
setInterval(syncNow, syncInterval);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) =>
  res.json({ ok: !state.error, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error })
);
app.get('/api/dashboard', (_req, res) =>
  res.json({ dashboard: state.dashboard, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error })
);
app.get('/api/ipos', (_req, res) => res.json({ data: state.ipos, lastSynced: state.lastSynced, nextSync: state.nextSync }));
app.get('/api/applicants', (_req, res) =>
  res.json({ data: state.applicants, lastSynced: state.lastSynced, nextSync: state.nextSync })
);

app.post('/api/admin/login', (req, res) => {
  if (!requirePin(req, res)) return;
  res.json({ ok: true });
});

app.post('/api/admin/reveal', (req, res) => {
  if (!requirePin(req, res)) return;
  res.json({ data: state.sensitiveApplicants, lastSynced: state.lastSynced });
});

app.post('/api/admin/sync', async (req, res) => {
  if (!requirePin(req, res)) return;
  await syncNow();
  res.json({ ok: !state.error, lastSynced: state.lastSynced, nextSync: state.nextSync, error: state.error });
});

app.get('/api/admin/data', async (req, res) => {
  if (String(req.headers['x-admin-pin'] || '') !== adminPin) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ ipos: state.ipos, applicants: state.sensitiveApplicants, lastSynced: state.lastSynced });
});

app.put('/api/admin/ipos', async (req, res) => {
  if (!requirePin(req, res)) return;
  try {
    const incoming = Array.isArray(req.body?.ipos) ? req.body.ipos : [];
    const ipos = incoming.map((x, i) => normalizeIpo(x, i + 1));
    if (ipos.some((x) => !x.name)) return res.status(400).json({ error: 'Every IPO must have a name.' });
    await writeIposRemote(ipos);
    await syncNow();
    res.json({ ok: true, data: state.ipos, lastSynced: state.lastSynced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/applicants', async (req, res) => {
  if (!requirePin(req, res)) return;
  try {
    const incoming = Array.isArray(req.body?.applicants) ? req.body.applicants : [];
    const applicants = incoming.map((x) => ({
      name: String(x.name ?? '').trim(),
      depository: String(x.depository ?? '').trim(),
      pan: String(x.pan ?? '').trim(),
      beneficiaryId: String(x.beneficiaryId ?? '').trim(),
    }));
    if (applicants.some((x) => !x.name)) return res.status(400).json({ error: 'Every applicant must have a name.' });
    await writeApplicantsRemote(applicants);
    await syncNow();
    res.json({ ok: true, data: state.sensitiveApplicants, lastSynced: state.lastSynced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const clientDist = path.resolve(root, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDist, 'index.html'))));
}

app.listen(port, () => console.log(`IPO Tracker server running on http://localhost:${port}`));
