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
const adminPin = process.env.ADMIN_PIN || "change-me";
const syncInterval = Number(process.env.SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000);

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
  if (!value) return "";

  const s = String(value);

  return s.length <= 4 ? "••••" : `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

function maskId(value) {
  if (!value) return "";

  const s = String(value);

  return s.length <= 5 ? "•••••" : `••••••••${s.slice(-5)}`;
}

function num(value) {
  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}

function normalizeIpo(input, fallbackId) {
  const investment = num(input?.investment);
  const profit = num(input?.profit);

  return {
    id: input?.id ?? fallbackId,
    date: input?.date || null,
    name: String(input?.name ?? "").trim(),

    applicants: num(input?.applicants),

    retailAmount: num(input?.retailAmount),

    investment,

    allotments: num(input?.allotments),

    profit,

    roi: investment > 0 ? profit / investment : 0,
  };
}

function normalizeApplicant(input) {
  return {
    name: String(input?.name ?? "").trim(),

    depository: String(input?.depository ?? "").trim(),

    pan: String(input?.pan ?? "").trim(),

    beneficiaryId: String(input?.beneficiaryId ?? "").trim(),
  };
}

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

  const roi = totalInvestment > 0 ? totalProfit / totalInvestment : 0;

  const totalAmount = totalInvestment + totalProfit;

  return {
    "Total IPOs": totalIpos,

    "Total Applications": totalApplications,

    "Total Allotments": totalAllotments,

    "Total Profit": totalProfit,

    ROI: roi,

    "Total Amount": totalAmount,
  };
}

function updateState(data) {
  const rawIpos = Array.isArray(data?.ipos) ? data.ipos : [];

  const rawApplicants = Array.isArray(data?.applicants) ? data.applicants : [];

  const ipos = rawIpos.map((ipo, index) => normalizeIpo(ipo, index + 1));

  const sensitiveApplicants = rawApplicants.map(normalizeApplicant);

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
}

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

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "1mb",
  }),
);

/* ---------------------------------
   HEALTH
---------------------------------- */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: !state.error,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ---------------------------------
   PUBLIC SYNC
---------------------------------- */

app.post("/api/sync", async (_req, res) => {
  const ok = await syncFromGoogle();

  res.json({
    ok,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ---------------------------------
   DASHBOARD
---------------------------------- */

app.get("/api/dashboard", (_req, res) => {
  res.json({
    dashboard: state.dashboard,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,

    error: state.error,
  });
});

/* ---------------------------------
   IPOs
---------------------------------- */

app.get("/api/ipos", (_req, res) => {
  res.json({
    data: state.ipos,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,
  });
});

/* ---------------------------------
   APPLICANTS
---------------------------------- */

app.get("/api/applicants", (_req, res) => {
  res.json({
    data: state.applicants,

    lastSynced: state.lastSynced,

    nextSync: state.nextSync,
  });
});

/* ---------------------------------
   ADMIN LOGIN
---------------------------------- */

app.post("/api/admin/login", (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  res.json({
    ok: true,
  });
});

/* ---------------------------------
   ADMIN REVEAL
---------------------------------- */

app.post("/api/admin/reveal", (req, res) => {
  if (!requirePin(req, res)) {
    return;
  }

  res.json({
    data: state.sensitiveApplicants,

    lastSynced: state.lastSynced,
  });
});

/* ---------------------------------
   ADMIN DATA
---------------------------------- */

app.get("/api/admin/data", (req, res) => {
  if (!requireHeaderPin(req, res)) {
    return;
  }

  res.json({
    ipos: state.ipos,

    applicants: state.sensitiveApplicants,

    lastSynced: state.lastSynced,
  });
});

/* ---------------------------------
   ADMIN SYNC
---------------------------------- */

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

/* ---------------------------------
   ADMIN SAVE IPOs
---------------------------------- */

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

      lastSynced: state.lastSynced,
    });
  } catch (error) {
    console.error("Save IPOs failed:", error);

    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/* ---------------------------------
   ADMIN SAVE APPLICANTS
---------------------------------- */

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
    });
  } catch (error) {
    console.error("Save applicants failed:", error);

    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/* ---------------------------------
   FRONTEND DIST
---------------------------------- */

const clientDist = path.resolve(root, "..", "client", "dist");

if (true) {
  app.use(express.static(clientDist));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    if (req.method !== "GET") {
      return next();
    }

    res.sendFile(path.join(clientDist, "index.html"));
  });
}

/* ---------------------------------
   START SERVER
---------------------------------- */

async function start() {
  console.log("Starting IPO Tracker server...");

  console.log(`Google sync interval: ${syncInterval} ms`);

  await syncFromGoogle();

  setInterval(syncFromGoogle, syncInterval);

  app.listen(port, () => {
    console.log(`IPO Tracker server running on port ${port}`);
  });
}

start();
