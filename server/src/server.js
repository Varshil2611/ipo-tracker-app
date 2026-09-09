import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchData,
  writeIposRemote,
  writeApplicantsRemote,
} from "./appsScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, "..");

const port = Number(process.env.PORT || 4000);

/*
 * Admin PIN should always come from Render environment variables.
 */
const adminPin = process.env.ADMIN_PIN || "change-me";

/*
 * Google Sheets automatic sync:
 *
 * Default = 12 hours
 *
 * You can override this from Render:
 *
 * SYNC_INTERVAL_MS=43200000
 *
 * 12 hours = 43,200,000 milliseconds
 */
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

const syncInterval = Number(process.env.SYNC_INTERVAL_MS || TWELVE_HOURS);

let state = {
  dashboard: {},

  ipos: [],

  applicants: [],

  sensitiveApplicants: [],

  lastSynced: null,

  nextSync: null,

  error: null,
};

/* ============================================================
   HELPERS
   ============================================================ */

function maskPan(value) {
  if (!value) {
    return "";
  }

  const s = String(value);

  return s.length <= 4 ? "••••" : `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

function maskId(value) {
  if (!value) {
    return "";
  }

  const s = String(value);

  return s.length <= 5 ? "•••••" : `••••••••${s.slice(-5)}`;
}

function num(value) {
  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}

/* ============================================================
   IPO NORMALIZATION
   ============================================================ */

function normalizeIpo(input, fallbackId) {
  const investment = num(input?.investment ?? input?.totalInvestment);

  const profit = num(input?.profit);

  /*
   * Correct ROI:
   *
   * ROI = Profit / Investment × 100
   *
   * If investment is zero, ROI is zero.
   */
  const roi = investment > 0 ? (profit / investment) * 100 : 0;

  return {
    id: input?.id ?? fallbackId,

    date: input?.date || null,

    name: String(input?.name ?? "").trim(),

    applicants: num(input?.applicants),

    retailAmount: num(input?.retailAmount),

    investment,

    allotments: num(input?.allotments),

    profit,

    roi,
  };
}

/* ============================================================
   APPLICANT NORMALIZATION
   ============================================================ */

function normalizeApplicant(input) {
  return {
    name: String(input?.name ?? "").trim(),

    depository: String(input?.depository ?? "").trim(),

    pan: String(input?.pan ?? "").trim(),

    beneficiaryId: String(input?.beneficiaryId ?? "").trim(),
  };
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function buildDashboard(ipos) {
  const totalIpos = ipos.length;

  const totalApplications = ipos.reduce(
    (sum, ipo) => sum + num(ipo.applicants),
    0,
  );

  const totalAllotments = ipos.reduce(
    (sum, ipo) => sum + num(ipo.allotments),
    0,
  );

  const totalProfit = ipos.reduce((sum, ipo) => sum + num(ipo.profit), 0);

  const totalInvestment = ipos.reduce(
    (sum, ipo) => sum + num(ipo.investment),
    0,
  );

  /*
   * Overall ROI:
   *
   * Total Profit / Total Investment × 100
   */
  const roi = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

  /*
   * Total Amount represents:
   *
   * Investment + Profit
   *
   * No hard-coded amount.
   */
  const totalAmount = 530000 + totalProfit;

  return {
    "Total IPOs": totalIpos,

    "Total Applications": totalApplications,

    "Total Allotments": totalAllotments,

    "Total Investment": totalInvestment,

    "Total Profit": totalProfit,

    "Total Amount": totalAmount,

    ROI: roi,
  };
}

/* ============================================================
   STATE UPDATE
   ============================================================ */

function updateState(data) {
  const rawIpos = Array.isArray(data?.ipos) ? data.ipos : [];

  const rawApplicants = Array.isArray(data?.applicants) ? data.applicants : [];

  const ipos = rawIpos.map((ipo, index) => normalizeIpo(ipo, index + 1));

  const sensitiveApplicants = rawApplicants.map(normalizeApplicant);

  /*
   * Public applicants:
   *
   * PAN and beneficiary ID are masked.
   */
  const applicants = sensitiveApplicants.map((applicant) => ({
    name: applicant.name,

    depository: applicant.depository,

    pan: maskPan(applicant.pan),

    beneficiaryId: maskId(applicant.beneficiaryId),
  }));

  const now = new Date();

  state = {
    dashboard: buildDashboard(ipos),

    ipos,

    applicants,

    sensitiveApplicants,

    lastSynced: now.toISOString(),

    nextSync: new Date(now.getTime() + syncInterval).toISOString(),

    error: null,
  };

  console.log(
    `Synced Google Sheets: ${ipos.length} IPOs, ${sensitiveApplicants.length} applicants`,
  );

  console.log(`Next automatic sync: ${state.nextSync}`);
}

/* ============================================================
   GOOGLE SHEETS SYNC
   ============================================================ */

async function syncFromGoogle() {
  try {
    console.log("Syncing from Google Sheets...");

    const data = await fetchData();

    updateState(data);

    return true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);

    console.error("Google Sheets sync failed:", state.error);

    return false;
  }
}

/* ============================================================
   ADMIN PIN
   ============================================================ */

function requirePin(req, res) {
  if (String(req.body?.pin || "") !== adminPin) {
    res.status(401).json({
      error: "Invalid PIN",
    });

    return false;
  }

  return true;
}

function requireHeaderPin(req, res) {
  if (String(req.headers["x-admin-pin"] || "") !== adminPin) {
    res.status(401).json({
      error: "Invalid PIN",
    });

    return false;
  }

  return true;
}

/* ============================================================
   EXPRESS APP
   ============================================================ */

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "1mb",
  }),
);

/* ============================================================
   HEALTH
   ============================================================ */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: !state.error,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,

    syncInterval,

    syncIntervalHours: syncInterval / (60 * 60 * 1000),
  });
});

/* ============================================================
   PUBLIC SYNC
   ============================================================ */

app.post("/api/sync", async (_req, res) => {
  const ok = await syncFromGoogle();

  res.json({
    ok,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ============================================================
   DASHBOARD
   ============================================================ */

app.get("/api/dashboard", (_req, res) => {
  res.json({
    dashboard: state.dashboard,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ============================================================
   IPOs
   ============================================================ */

app.get("/api/ipos", (_req, res) => {
  res.json({
    data: state.ipos,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,
  });
});

/* ============================================================
   APPLICANTS
   ============================================================ */

app.get("/api/applicants", (_req, res) => {
  res.json({
    data: state.applicants,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,
  });
});

/* ============================================================
   ADMIN LOGIN
   ============================================================ */

app.post("/api/admin/login", (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  res.json({
    ok: true,
  });
});

/* ============================================================
   ADMIN REVEAL
   ============================================================ */

app.post("/api/admin/reveal", (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  res.json({
    data: state.sensitiveApplicants,

    lastSynced: state.lastSynced,
  });
});

/* ============================================================
   ADMIN DATA
   ============================================================ */

app.get("/api/admin/data", (req, res) => {
  if (!requireHeaderPin(req, res)) {
    return;
  }

  res.json({
    ipos: state.ipos,

    applicants: state.sensitiveApplicants,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,
  });
});

/* ============================================================
   ADMIN SYNC
   ============================================================ */

app.post("/api/admin/sync", async (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  const ok = await syncFromGoogle();

  res.json({
    ok,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ============================================================
   ADMIN SAVE IPOs
   ============================================================ */

app.put("/api/admin/ipos", async (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  try {
    const incoming = Array.isArray(req.body?.ipos) ? req.body.ipos : [];

    const ipos = incoming.map((ipo, index) => normalizeIpo(ipo, index + 1));

    if (ipos.some((ipo) => !ipo.name)) {
      return res.status(400).json({
        error: "Every IPO must have a name.",
      });
    }

    console.log(`Saving ${ipos.length} IPOs to Google Sheets...`);

    await writeIposRemote(ipos);

    const ok = await syncFromGoogle();

    if (!ok) {
      return res.status(500).json({
        error:
          state.error ||
          "Saved, but could not refresh data from Google Sheets.",
      });
    }

    res.json({
      ok: true,

      data: state.ipos,

      dashboard: state.dashboard,

      lastSynced: state.lastSynced,

      nextSync: state.nextSync,
    });
  } catch (error) {
    console.error("Save IPOs failed:", error);

    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/* ============================================================
   ADMIN SAVE APPLICANTS
   ============================================================ */

app.put("/api/admin/applicants", async (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  try {
    const incoming = Array.isArray(req.body?.applicants)
      ? req.body.applicants
      : [];

    const applicants = incoming.map(normalizeApplicant);

    if (applicants.some((applicant) => !applicant.name)) {
      return res.status(400).json({
        error: "Every applicant must have a name.",
      });
    }

    console.log(`Saving ${applicants.length} applicants to Google Sheets...`);

    await writeApplicantsRemote(applicants);

    const ok = await syncFromGoogle();

    if (!ok) {
      return res.status(500).json({
        error:
          state.error ||
          "Saved, but could not refresh data from Google Sheets.",
      });
    }

    res.json({
      ok: true,

      data: state.sensitiveApplicants,

      lastSynced: state.lastSynced,

      nextSync: state.nextSync,
    });
  } catch (error) {
    console.error("Save applicants failed:", error);

    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/* ============================================================
   FRONTEND DIST
   ============================================================ */

/*
 * Render deployment structure:
 *
 * ipo-tracker-app/
 * ├── client/
 * │   └── dist/
 * └── server/
 *     └── index.js
 *
 * From server/index.js:
 *
 * __dirname = .../server
 *
 * root = .../ipo-tracker-app
 *
 * clientDist = .../ipo-tracker-app/client/dist
 */
const clientDist = path.resolve(root, "..", "client", "dist");

console.log(`Frontend dist path: ${clientDist}`);

app.use(express.static(clientDist));

/*
 * SPA fallback.
 *
 * API routes are allowed to continue
 * to their normal 404 handling.
 */
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(path.join(clientDist, "index.html"), (error) => {
    if (error) {
      next(error);
    }
  });
});

/* ============================================================
   START SERVER
   ============================================================ */

async function start() {
  console.log("Starting IPO Tracker server...");

  console.log(`Google Sheets automatic sync interval: ${syncInterval} ms`);

  console.log(
    `Google Sheets automatic sync interval: ${
      syncInterval / (60 * 60 * 1000)
    } hours`,
  );

  /*
   * Initial sync when Render starts.
   */
  await syncFromGoogle();

  /*
   * Automatic sync every 12 hours.
   */
  setInterval(syncFromGoogle, syncInterval);

  app.listen(port, () => {
    console.log(`IPO Tracker server running on port ${port}`);

    console.log(`Next automatic Google Sheets sync: ${state.nextSync}`);
  });
}

start();
