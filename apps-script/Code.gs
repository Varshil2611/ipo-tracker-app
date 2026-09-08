/**
 * IPO Tracker — Apps Script backend.
 *
 * HOW TO USE (see README.md for the full walkthrough):
 * 1. Open your Google Sheet.
 * 2. Extensions → Apps Script.
 * 3. Delete any starter code and paste this whole file in.
 * 4. Change SECRET below to your own random string.
 * 5. Deploy → New deployment → type "Web app" → Execute as "Me" →
 *    Who has access "Anyone" → Deploy → Authorize it (it's your own script,
 *    the "unverified" warning is normal and expected).
 * 6. Copy the Web app URL (ends in /exec) into your server's .env as
 *    APPS_SCRIPT_URL. Put the SECRET value below into APPS_SCRIPT_SECRET.
 *
 * This script does NOT touch Google Cloud Console and has no billing concept -
 * Apps Script is free for personal Google accounts, with a daily quota (20,000
 * URL Fetch requests/day) far beyond what a small tracker needs.
 */

// CHANGE THIS to your own random string - it's the "password" between your
// server and this script, since the deployment URL itself is not secret.
const SECRET = 'change-this-to-a-long-random-string';

const IPOS_SHEET = 'IPOs';
const APPLICANTS_SHEET = 'Applicants';
const IPO_HEADERS = ['IPO Id', 'Date', 'IPO Name', 'Applicants', 'Retail Amount', 'Total Investment', 'Allotments', 'Profit', 'ROI'];
const APPLICANT_HEADERS = ['Applicant Name', 'Depository Type', 'PanCard Number', 'Beneficiary Number/ID'];

function doGet(e) {
  try {
    if ((e.parameter.secret || '') !== SECRET) return jsonOut({ error: 'Unauthorized' });
    ensureSheets_();
    const ipoRows = readRows_(IPOS_SHEET);
    const applicantRows = readRows_(APPLICANTS_SHEET);
    return jsonOut({
      ipos: ipoRows.map(rowToIpo_),
      applicants: applicantRows.map(rowToApplicant_),
    });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if ((body.secret || '') !== SECRET) return jsonOut({ error: 'Unauthorized' });
    ensureSheets_();

    if (body.action === 'writeIpos') {
      const rows = (body.data || []).map(ipoToRow_);
      writeRows_(IPOS_SHEET, IPO_HEADERS, rows);
      return jsonOut({ ok: true });
    }
    if (body.action === 'writeApplicants') {
      const rows = (body.data || []).map(applicantToRow_);
      writeRows_(APPLICANTS_SHEET, APPLICANT_HEADERS, rows);
      return jsonOut({ ok: true });
    }
    return jsonOut({ error: 'Unknown action: ' + body.action });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

// ---- helpers ----

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureOneSheet_(ss, IPOS_SHEET, IPO_HEADERS);
  ensureOneSheet_(ss, APPLICANTS_SHEET, APPLICANT_HEADERS);
}

function ensureOneSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow.some((v) => v !== '' && v != null);
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function readRows_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues().filter((r) => r[0] !== '' && r[0] != null);
}

function writeRows_(sheetName, headers, rows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function rowToIpo_(r) {
  return {
    id: r[0],
    date: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
    name: r[2] || '',
    applicants: Number(r[3]) || 0,
    retailAmount: Number(r[4]) || 0,
    investment: Number(r[5]) || 0,
    allotments: Number(r[6]) || 0,
    profit: Number(r[7]) || 0,
    roi: Number(r[8]) || 0,
  };
}

function ipoToRow_(x) {
  return [x.id, x.date || '', x.name, num_(x.applicants), num_(x.retailAmount), num_(x.investment), num_(x.allotments), num_(x.profit), x.investment ? num_(x.profit) / num_(x.investment) : 0];
}

function rowToApplicant_(r) {
  return { name: r[0] || '', depository: r[1] || '', pan: r[2] || '', beneficiaryId: r[3] || '' };
}

function applicantToRow_(x) {
  return [x.name || '', x.depository || '', x.pan || '', x.beneficiaryId || ''];
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
