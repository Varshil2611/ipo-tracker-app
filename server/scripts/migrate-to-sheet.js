/**
 * One-time helper: reads your existing "IPO Tracker Updated.xlsx" and pushes its
 * data into the Google Sheet through your Apps Script web app.
 *
 * Usage:
 *   node server/scripts/migrate-to-sheet.js [path-to-xlsx]
 *
 * Requires APPS_SCRIPT_URL and APPS_SCRIPT_SECRET in your .env (same as the server),
 * and the "xlsx" package (already a devDependency here).
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { writeIposRemote, writeApplicantsRemote } from '../src/appsScript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(__dirname, '..', 'data', 'IPO Tracker Updated.xlsx');
const xlsxPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toIsoDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Reading ${xlsxPath} ...`);
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });

  const dash = wb.Sheets['Dashboard'];
  if (!dash) throw new Error('Could not find a "Dashboard" sheet in the workbook.');
  const rows = XLSX.utils.sheet_to_json(dash, { header: 1, defval: null });
  const headerIndex = rows.findIndex((r) => r?.[0] === 'IPO Id');
  const ipoRows = headerIndex >= 0 ? XLSX.utils.sheet_to_json(dash, { range: headerIndex, defval: null }) : [];
  const ipos = ipoRows
    .filter((r) => r['IPO Id'] != null)
    .map((r) => ({
      id: r['IPO Id'],
      date: toIsoDate(r['Date '] ?? r['Date']),
      name: r['IPO Name'] ?? '',
      applicants: num(r.Applicants),
      retailAmount: num(r['Retail Amount']),
      investment: num(r['Total Invesment'] ?? r['Total Investment']),
      allotments: num(r.Allotments),
      profit: num(r.Profit),
    }));

  const applicantsSheet = wb.Sheets['Applicant Details'];
  const applicants = applicantsSheet
    ? XLSX.utils
        .sheet_to_json(applicantsSheet, { defval: null })
        .filter((r) => r['Applicant Name'])
        .map((r) => ({
          name: r['Applicant Name'],
          depository: r['Depository Type'],
          pan: r['PanCard Number'],
          beneficiaryId: r['Benificiary Number/ID'],
        }))
    : [];

  console.log(`Found ${ipos.length} IPO rows and ${applicants.length} applicant rows.`);
  console.log('Writing IPOs to the Sheet...');
  await writeIposRemote(ipos);
  console.log('Writing Applicants to the Sheet...');
  await writeApplicantsRemote(applicants);

  console.log('Done! Your Google Sheet now has this data.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
