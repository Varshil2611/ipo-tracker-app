/**
 * IPO Tracker — Apps Script backend.
 *
 * Sheets used:
 *   IPOs, Applicants, Dashboard, Capital, Investments
 *
 * Available Capital =
 *   Initial Capital
 *   + Total IPO Profit
 *   + Profit/Loss of SOLD investments
 *   - Amount of investments still HELD (no sold date)
 *
 * After changing this file:
 *   Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy
 */

const SECRET = "secretkeyipo";

const SPREADSHEET_ID = "1umpm3bWKqZNSsEWDIRfesbuY7pw1DHzXHPSFLOwuZmE";

const IPOS_SHEET = "IPOs";
const APPLICANTS_SHEET = "Applicants";
const DASHBOARD_SHEET = "Dashboard";
const CAPITAL_SHEET = "Capital";
const INVESTMENTS_SHEET = "Investments";

const DEFAULT_INITIAL_CAPITAL = 530000;

const IPO_HEADERS = [
  "IPO Id",
  "Date",
  "IPO Name",
  "Applicants",
  "Retail Amount",
  "Total Investment",
  "Allotments",
  "Profit",
  "ROI",
];

const APPLICANT_HEADERS = [
  "Applicant Name",
  "Depository Type",
  "PanCard Number",
  "Beneficiary Number/ID",
];

const CAPITAL_HEADERS = ["Initial Capital"];

const INVESTMENT_HEADERS = [
  "Investment Name",
  "Amount",
  "Purchase Date",
  "Sold Date",
  "Profit/Loss",
];

/* =========================================
   GET
========================================= */

function doGet(e) {
  try {
    var secret = "";

    if (e && e.parameter && e.parameter.secret) {
      secret = e.parameter.secret;
    }

    if (secret !== SECRET) {
      return jsonOut({ error: "Unauthorized" });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    ensureSheets(ss);

    updateDashboardFormulas(ss);

    var ipos = readRows(ss, IPOS_SHEET);
    var applicants = readRows(ss, APPLICANTS_SHEET);
    var investmentRows = readRows(ss, INVESTMENTS_SHEET);

    var ipoData = [];
    var totalProfit = 0;

    for (var i = 0; i < ipos.length; i++) {
      ipoData.push(rowToIpo(ipos[i]));
      totalProfit += num(ipos[i][7]);
    }

    var applicantData = [];

    for (var j = 0; j < applicants.length; j++) {
      applicantData.push(rowToApplicant(applicants[j]));
    }

    var investments = [];
    var stockInvestment = 0;
    var stockProfit = 0;

    for (var k = 0; k < investmentRows.length; k++) {
      var inv = rowToInvestment(investmentRows[k]);

      investments.push(inv);

      if (inv.soldDate) {
        stockProfit += inv.profit;
      } else {
        stockInvestment += inv.amount;
      }
    }

    var initialCapital = readInitialCapital(ss);

    var availableCapital =
      initialCapital + totalProfit + stockProfit - stockInvestment;

    return jsonOut({
      ipos: ipoData,
      applicants: applicantData,
      investments: investments,
      capital: {
        initialCapital: initialCapital,
        stockInvestment: stockInvestment,
        stockProfit: stockProfit,
        totalProfit: totalProfit,
        availableCapital: availableCapital,
      },
    });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

/* =========================================
   POST
========================================= */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ error: "No POST data received" });
    }

    var body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonOut({ error: "Unauthorized" });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    ensureSheets(ss);

    /* -------------------------------------
       WRITE IPOs
    -------------------------------------- */

    if (body.action === "writeIpos") {
      var ipoRows = [];
      var data = body.data || [];

      for (var i = 0; i < data.length; i++) {
        ipoRows.push(ipoToRow(data[i]));
      }

      writeRows(ss, IPOS_SHEET, IPO_HEADERS, ipoRows);

      updateDashboardFormulas(ss);

      SpreadsheetApp.flush();

      return jsonOut({ ok: true });
    }

    /* -------------------------------------
       WRITE APPLICANTS
    -------------------------------------- */

    if (body.action === "writeApplicants") {
      var applicantRows = [];
      var applicantData = body.data || [];

      for (var j = 0; j < applicantData.length; j++) {
        applicantRows.push(applicantToRow(applicantData[j]));
      }

      writeRows(ss, APPLICANTS_SHEET, APPLICANT_HEADERS, applicantRows);

      updateDashboardFormulas(ss);

      SpreadsheetApp.flush();

      return jsonOut({ ok: true });
    }

    /* -------------------------------------
       WRITE INVESTMENTS
    -------------------------------------- */

    if (body.action === "writeInvestments") {
      var investmentRows = [];
      var investmentData = body.data || [];

      for (var k = 0; k < investmentData.length; k++) {
        investmentRows.push(investmentToRow(investmentData[k]));
      }

      writeRows(ss, INVESTMENTS_SHEET, INVESTMENT_HEADERS, investmentRows);

      SpreadsheetApp.flush();

      return jsonOut({ ok: true });
    }

    return jsonOut({ error: "Unknown action: " + body.action });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

/* =========================================
   ENSURE SHEETS
========================================= */

function ensureSheets(ss) {
  ensureOneSheet(ss, IPOS_SHEET, IPO_HEADERS);

  ensureOneSheet(ss, APPLICANTS_SHEET, APPLICANT_HEADERS);

  ensureOneSheet(ss, INVESTMENTS_SHEET, INVESTMENT_HEADERS);

  // Upgrade older 2-column Investments header row to the 5-column one
  ss.getSheetByName(INVESTMENTS_SHEET)
    .getRange(1, 1, 1, INVESTMENT_HEADERS.length)
    .setValues([INVESTMENT_HEADERS]);

  ensureCapitalSheet(ss);

  ensureDashboardSheet(ss);
}

/* =========================================
   ENSURE NORMAL SHEET
========================================= */

function ensureOneSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  var hasHeaders = false;

  for (var i = 0; i < firstRow.length; i++) {
    if (firstRow[i] !== "" && firstRow[i] !== null) {
      hasHeaders = true;
      break;
    }
  }

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

/* =========================================
   CAPITAL SHEET (Initial Capital only)
========================================= */

function ensureCapitalSheet(ss) {
  var sheet = ss.getSheetByName(CAPITAL_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CAPITAL_SHEET);
  }

  var firstCell = sheet.getRange(1, 1).getValue();

  if (firstCell === "" || firstCell === null) {
    sheet
      .getRange(1, 1, 1, CAPITAL_HEADERS.length)
      .setValues([CAPITAL_HEADERS]);
  }

  var value = sheet.getRange(2, 1).getValue();

  if (value === "" || value === null) {
    sheet.getRange(2, 1).setValue(DEFAULT_INITIAL_CAPITAL);
  }
}

function readInitialCapital(ss) {
  var sheet = ss.getSheetByName(CAPITAL_SHEET);

  if (!sheet) {
    return DEFAULT_INITIAL_CAPITAL;
  }

  var value = num(sheet.getRange(2, 1).getValue());

  return value > 0 ? value : DEFAULT_INITIAL_CAPITAL;
}

/* =========================================
   DASHBOARD SHEET
========================================= */

function ensureDashboardSheet(ss) {
  var sheet = ss.getSheetByName(DASHBOARD_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(DASHBOARD_SHEET);
  }

  sheet.getRange("A1:B8").setValues([
    ["IPO Tracker Dashboard", ""],
    ["", ""],
    ["Total IPOs", ""],
    ["Total Applications", ""],
    ["Total Allotments", ""],
    ["Total Profit", ""],
    ["Total Investment", ""],
    ["ROI", ""],
  ]);
}

/* =========================================
   DASHBOARD FORMULAS
========================================= */

function updateDashboardFormulas(ss) {
  var sheet = ss.getSheetByName(DASHBOARD_SHEET);

  if (!sheet) {
    ensureDashboardSheet(ss);
    sheet = ss.getSheetByName(DASHBOARD_SHEET);
  }

  sheet.getRange("A1:B10").setValues([
    ["IPO Tracker Dashboard", ""],
    ["Last Updated", new Date()],
    ["Total IPOs", ""],
    ["Total Applications", ""],
    ["Total Allotments", ""],
    ["Total Profit", ""],
    ["Total Investment", ""],
    ["ROI", ""],
    ["Total Amount", ""],
    ["Applicant Count", ""],
  ]);

  sheet.getRange("B3").setFormula("=COUNTA(IPOs!C2:C)");
  sheet.getRange("B4").setFormula("=SUM(IPOs!D2:D)");
  sheet.getRange("B5").setFormula("=SUM(IPOs!G2:G)");
  sheet.getRange("B6").setFormula("=SUM(IPOs!H2:H)");
  sheet.getRange("B7").setFormula("=SUM(IPOs!F2:F)");
  sheet.getRange("B8").setFormula("=IF(B7>0,B6/B7,0)");
  sheet.getRange("B9").setFormula("=B7+B6");
  sheet.getRange("B10").setFormula("=COUNTA(Applicants!A2:A)");

  sheet.getRange("B2").setNumberFormat("dd-mmm-yyyy hh:mm:ss");
  sheet.getRange("B6:B7").setNumberFormat("₹#,##0");
  sheet.getRange("B9").setNumberFormat("₹#,##0");
  sheet.getRange("B8").setNumberFormat("0.00%");
}

/* =========================================
   READ ROWS
========================================= */

function readRows(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return [];
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  var lastColumn = Math.max(sheet.getLastColumn(), 1);

  return sheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .getValues()
    .filter(function (row) {
      return row[0] !== "" && row[0] !== null;
    });
}

/* =========================================
   WRITE ROWS
========================================= */

function writeRows(ss, sheetName, headers, rows) {
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }

  var lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

/* =========================================
   IPO → OBJECT
========================================= */

function rowToIpo(row) {
  return {
    id: row[0],

    date:
      row[1] instanceof Date
        ? Utilities.formatDate(
            row[1],
            Session.getScriptTimeZone(),
            "yyyy-MM-dd",
          )
        : String(row[1] || ""),

    name: row[2] || "",

    applicants: Number(row[3]) || 0,

    retailAmount: Number(row[4]) || 0,

    investment: Number(row[5]) || 0,

    allotments: Number(row[6]) || 0,

    profit: Number(row[7]) || 0,

    roi: Number(row[8]) || 0,
  };
}

/* =========================================
   IPO → ROW
========================================= */

function ipoToRow(ipo) {
  var investment = num(ipo.investment);

  var profit = num(ipo.profit);

  var roi = 0;

  if (investment > 0) {
    roi = profit / investment;
  }

  return [
    ipo.id || "",
    ipo.date || "",
    ipo.name || "",
    num(ipo.applicants),
    num(ipo.retailAmount),
    investment,
    num(ipo.allotments),
    profit,
    roi,
  ];
}

/* =========================================
   APPLICANT → OBJECT
========================================= */

function rowToApplicant(row) {
  return {
    name: row[0] || "",
    depository: row[1] || "",
    pan: row[2] || "",
    beneficiaryId: row[3] || "",
  };
}

/* =========================================
   APPLICANT → ROW
========================================= */

function applicantToRow(applicant) {
  return [
    applicant.name || "",
    applicant.depository || "",
    applicant.pan || "",
    applicant.beneficiaryId || "",
  ];
}

/* =========================================
   INVESTMENT ↔ ROW
========================================= */

function formatSheetDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return String(v || "");
}

function rowToInvestment(row) {
  var soldDate = formatSheetDate(row[3]);

  return {
    name: String(row[0] || ""),
    amount: Math.max(0, num(row[1])),
    purchaseDate: formatSheetDate(row[2]),
    soldDate: soldDate,
    profit: soldDate ? num(row[4]) : 0,
  };
}

function investmentToRow(x) {
  var soldDate = String(x.soldDate || "").trim();

  return [
    String(x.name || "").trim(),
    Math.max(0, num(x.amount)),
    String(x.purchaseDate || "").trim(),
    soldDate,
    soldDate ? num(x.profit) : 0,
  ];
}

/* =========================================
   NUMBER
========================================= */

function num(value) {
  var n = Number(value);

  if (isFinite(n)) {
    return n;
  }

  return 0;
}

/* =========================================
   JSON OUTPUT
========================================= */

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
